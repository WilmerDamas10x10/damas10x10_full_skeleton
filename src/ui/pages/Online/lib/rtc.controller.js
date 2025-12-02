// ===============================================
// src/ui/pages/Online/lib/rtc.controller.js
// Controlador WebRTC simple para VIDEO + AUDIO
// -----------------------------------------------
// NO usa directamente WebSocket. En lugar de eso,
// recibe un callback `sendSignal` que tú conectas
// al canal WS (por ejemplo, enviando t:"ui"/op:"rtc").
//
// Uso típico desde mountOnline.js:
//
// import { createRTCController } from "./rtc.controller.js";
//
// const rtc = createRTCController({
//   sendSignal: (payload) => {
//     // aquí mandas por WS algo como:
//     // ws.send(JSON.stringify({ t:"ui", op:"rtc", payload }));
//   },
//   onLocalStream: (stream) => {
//     // asignar stream a <video id="cam-local">
//   },
//   onRemoteStream: (stream) => {
//     // asignar stream a <video id="cam-remota">
//   },
//   log: console.log,
// });
//
// // Al recibir un mensaje WS de tipo RTC, llamas:
// // rtc.handleSignalMessage(remotePayload);
//
// // Para iniciar cámara y oferta (caller):
// // await rtc.startLocalMedia();
// // await rtc.startAsCaller();
//
// // Para colgar:
// // rtc.stopAll();
//
// ===============================================

// ⚠️ Configuración STUN + TURN real (Xirsys)
const DEFAULT_RTC_CONFIG = {
  iceServers: [
    {
      urls: [
        "stun:sp-turn1.xirsys.com",
        "turn:sp-turn1.xirsys.com:80?transport=udp",
        "turn:sp-turn1.xirsys.com:3478?transport=udp",
        "turn:sp-turn1.xirsys.com:80?transport=tcp",
        "turn:sp-turn1.xirsys.com:3478?transport=tcp",
        "turns:sp-turn1.xirsys.com:443?transport=tcp",
        "turns:sp-turn1.xirsys.com:5349?transport=tcp",
      ],
      username:
        "CgkvbjKbtzSqX12B2fBRnWmZeQvTkY0e0QRxerUk1JeKliV-9Mvo4AWYzhvtP8PnAAAAAGkr04F3aWxtZXI=",
      credential: "ec30043c-cdab-11f0-8393-0242ac120004",
    },
  ],
};

// Pequeña utilidad de log para no explotar si no se pasa log()
function makeLogger(log) {
  if (typeof log === "function") return log;
  return () => {};
}

/**
 * Crea un controlador WebRTC encapsulado.
 *
 * @param {Object} options
 * @param {Function} options.sendSignal    - fn(payload) para enviar señalización via WS
 * @param {Function} options.onLocalStream  - fn(stream) cuando tenemos cámara/mic local
 * @param {Function} options.onRemoteStream - fn(stream) cuando llega video/audio remoto
 * @param {Function} [options.log]         - fn(...args) para debug (console.log)
 * @returns controlador RTC con métodos públicos
 */
export function createRTCController(options = {}) {
  const {
    sendSignal,
    onLocalStream,
    onRemoteStream,
    log: rawLog,
  } = options;

  const log = makeLogger(rawLog);

  if (typeof sendSignal !== "function") {
    console.warn(
      "[RTC] WARNING: createRTCController sin sendSignal. No podrá señalizar."
    );
  }

  let pc = null;
  let localStream = null;
  let remoteStream = null;
  let isCaller = false;
  let isStarted = false;
  let pendingRemoteCandidates = [];

  // ------------------------------------------
  // Interno: crea RTCPeerConnection si no existe
  // ------------------------------------------
  function ensurePeerConnection() {
    // Si hay una PC cerrada, la descartamos y creamos una nueva
    if (pc && pc.signalingState === "closed") {
      log(
        "[RTC] PeerConnection previa estaba 'closed', creando una nueva."
      );
      pc = null;
    }

    if (pc) {
      log(
        "[RTC] Reutilizando RTCPeerConnection existente. signalingState =",
        pc.signalingState,
        "connectionState =",
        pc.connectionState
      );
      return pc;
    }

    log("[RTC] Creando RTCPeerConnection…", DEFAULT_RTC_CONFIG);
    pc = new RTCPeerConnection(DEFAULT_RTC_CONFIG);

    // Cuando lleguen tracks remotos (video/audio)
    pc.ontrack = (event) => {
      log("[RTC] ontrack remoto, streams:", event.streams);
      const [stream] = event.streams || [];
      if (stream) {
        remoteStream = stream;
        if (typeof onRemoteStream === "function") {
          log(
            "[RTC] ontrack: asignando remoteStream a onRemoteStream()"
          );
          onRemoteStream(stream);
        }
      } else {
        log("[RTC] ontrack remoto sin stream[0]");
      }
    };

    // Envío de candidates (hielo) al otro peer
    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        log("[RTC] onicecandidate: fin de candidatos");
        if (typeof sendSignal === "function") {
          // opcional: avisar fin de candidatos al otro lado si lo necesitas
          // sendSignal({ kind: "ice", candidate: null });
        }
        return;
      }
      log("[RTC] onicecandidate: enviando candidate", {
        type: event.candidate.type,
        protocol: event.candidate.protocol,
        address: event.candidate.address,
        port: event.candidate.port,
      });
      if (typeof sendSignal === "function") {
        sendSignal({
          kind: "ice",
          candidate: event.candidate,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      log("[RTC] connectionState:", pc.connectionState);
      if (pc.connectionState === "failed") {
        log(
          "[RTC] Conexión RTC fallida (connectionState='failed'), se recomienda stopAll()"
        );
      }
    };

    pc.oniceconnectionstatechange = () => {
      log("[RTC] iceConnectionState:", pc.iceConnectionState);
    };

    pc.onsignalingstatechange = () => {
      log("[RTC] signalingState:", pc.signalingState);
    };

    return pc;
  }

  // ------------------------------------------
  // Iniciar cámara/micrófono local
  // ------------------------------------------
  async function startLocalMedia(constraints = { video: true, audio: true }) {
    if (localStream) {
      log(
        "[RTC] Local stream ya existe, reutilizando. tracks:",
        localStream.getTracks().map((t) => t.kind)
      );
      if (typeof onLocalStream === "function") onLocalStream(localStream);
      return localStream;
    }

    log("[RTC] Solicitando getUserMedia…", constraints);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        constraints
      );
      localStream = stream;
      log(
        "[RTC] getUserMedia OK. tracks:",
        stream.getTracks().map((t) => t.kind)
      );

      if (typeof onLocalStream === "function") {
        onLocalStream(stream);
      }

      // Si ya hay PeerConnection, añadimos pistas
      if (pc) {
        stream.getTracks().forEach((track) => {
          log(
            "[RTC] Añadiendo track local a PC (post-getUserMedia):",
            track.kind
          );
          pc.addTrack(track, stream);
        });
      }

      return stream;
    } catch (err) {
      console.error("[RTC] Error en getUserMedia:", err);
      throw err;
    }
  }

  // ------------------------------------------
  // Añadir pistas locales a la PC
  // (se llama al crear la PC y tras tener media)
  // ------------------------------------------
  function attachLocalTracks() {
    if (!pc || !localStream) {
      log(
        "[RTC] attachLocalTracks: no pc o no localStream."
      );
      return;
    }

    const senders = pc.getSenders();
    const existingTracks = senders
      .map((s) => s.track)
      .filter(Boolean);

    localStream.getTracks().forEach((track) => {
      const already = existingTracks.find(
        (t) => t && t.kind === track.kind
      );
      if (already) {
        log(
          "[RTC] Track local ya añadido, omitiendo:",
          track.kind
        );
        return;
      }
      log("[RTC] Añadiendo track local:", track.kind);
      pc.addTrack(track, localStream);
    });
  }

  // ------------------------------------------
  // Interno: volcar ICE remotos pendientes
  // ------------------------------------------
  async function flushPendingRemoteCandidates() {
    if (!pc || !pc.remoteDescription) {
      log(
        "[RTC] flushPendingRemoteCandidates: aún no hay pc o remoteDescription."
      );
      return;
    }
    if (!pendingRemoteCandidates.length) {
      return;
    }

    log(
      "[RTC] flushPendingRemoteCandidates: aplicando",
      pendingRemoteCandidates.length,
      "candidates en buffer."
    );

    const queue = pendingRemoteCandidates;
    pendingRemoteCandidates = [];

    for (const candidate of queue) {
      try {
        log("[RTC] Añadiendo candidate remoto (buffered)…");
        // candidate ya viene en formato RTCIceCandidateInit,
        // podemos pasarlo directamente a addIceCandidate.
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.error(
          "[RTC] Error al añadir ICE candidate remoto (buffered):",
          err
        );
      }
    }
  }

  // ------------------------------------------
  // Caller: inicia como emisor (crea OFERTA)
  // ------------------------------------------
  async function startAsCaller() {
    const connection = ensurePeerConnection();

    // Evitar múltiples ofertas mientras la señalización no esté estable
    if (connection.signalingState !== "stable") {
      log(
        "[RTC] startAsCaller: signalingState no es 'stable' (",
        connection.signalingState,
        "), ignorando llamada duplicada."
      );
      return;
    }

    // Si YA éramos caller y la PC sigue estable, evitamos ofertas duplicadas.
    // Pero si llegamos aquí habiendo sido antes "callee", PERMITIMOS
    // convertirnos ahora en caller para forzar una renegociación
    // (por ejemplo, cuando el segundo jugador enciende su cámara
    // después de que la llamada ya está conectada).
    if (isStarted && isCaller) {
      log(
        "[RTC] startAsCaller: ya iniciado anteriormente como caller, ignorando llamada adicional."
      );
      return;
    }

    // A partir de aquí podemos actuar como caller (primera vez
    // o renegociación desde el lado que antes era callee).
    isCaller = true;
    isStarted = true;

    // Asegurarnos de tener cámara/mic LOCAL (quien llama SÍ comparte algo)
    if (!localStream) {
      await startLocalMedia();
    }
    attachLocalTracks();

    log("[RTC] Caller: creando offer…");
    const offer = await connection.createOffer();
    log(
      "[RTC] Caller: offer creada. sdp length =",
      offer.sdp ? offer.sdp.length : 0
    );
    await connection.setLocalDescription(offer);
    log(
      "[RTC] Caller: setLocalDescription(offer) OK. signalingState =",
      connection.signalingState
    );

    if (typeof sendSignal === "function") {
      log("[RTC] Caller: enviando offer");
      sendSignal({
        kind: "offer",
        sdp: offer.sdp,
      });
    }
  }

  // ------------------------------------------
  // Callee: recibe una OFERTA del otro peer
  // ------------------------------------------
  async function handleRemoteOffer(sdp) {
    const connection = ensurePeerConnection();

    // Si ya estamos en negociación y no está estable, ignoramos offers extra
    if (connection.signalingState !== "stable") {
      log(
        "[RTC] Callee: offer recibida pero signalingState no es 'stable' (",
        connection.signalingState,
        "), ignorando offer duplicada."
      );
      return;
    }

    isCaller = false;
    isStarted = true;

    log(
      "[RTC] Callee: recibiendo offer… sdp length =",
      sdp ? sdp.length : 0
    );
    const desc = new RTCSessionDescription({ type: "offer", sdp });
    await connection.setRemoteDescription(desc);
    log(
      "[RTC] Callee: setRemoteDescription(offer) OK. signalingState =",
      connection.signalingState
    );

    // ⚠️ IMPORTANTE:
    // El CALLEE **NO** enciende cámara/mic automáticamente.
    // Solo adjunta pistas locales si YA tiene un stream local (por ejemplo,
    // si el usuario activó su propio micrófono/cámara manualmente).
    if (localStream) {
      log(
        "[RTC] Callee: ya hay localStream, adjuntando tracks."
      );
      attachLocalTracks();
    } else {
      log(
        "[RTC] Callee: sin localStream (modo solo receptor hasta que el usuario active su cámara/mic)."
      );
    }

    log("[RTC] Callee: creando answer…");
    const answer = await connection.createAnswer();
    log(
      "[RTC] Callee: answer creada. sdp length =",
      answer.sdp ? answer.sdp.length : 0
    );
    await connection.setLocalDescription(answer);
    log(
      "[RTC] Callee: setLocalDescription(answer) OK. signalingState =",
      connection.signalingState
    );

    if (typeof sendSignal === "function") {
      log("[RTC] Callee: enviando answer");
      sendSignal({
        kind: "answer",
        sdp: answer.sdp,
      });
    }

    // Ahora que tenemos remoteDescription, podemos volcar ICE pendientes
    await flushPendingRemoteCandidates();
  }

  // ------------------------------------------
  // Recibe ANSWER (el caller la procesa)
  // ------------------------------------------
  async function handleRemoteAnswer(sdp) {
    if (!pc) {
      console.warn(
        "[RTC] handleRemoteAnswer sin pc. Ignorando."
      );
      return;
    }

    // Solo aceptamos answer si tenemos una local-offer pendiente
    if (pc.signalingState !== "have-local-offer") {
      log(
        "[RTC] handleRemoteAnswer: signalingState no es 'have-local-offer' (",
        pc.signalingState,
        "), ignorando answer."
      );
      return;
    }

    log(
      "[RTC] Caller: recibiendo answer… sdp length =",
      sdp ? sdp.length : 0
    );
    const desc = new RTCSessionDescription({ type: "answer", sdp });
    await pc.setRemoteDescription(desc);
    log(
      "[RTC] Caller: setRemoteDescription(answer) OK. signalingState =",
      pc.signalingState
    );

    // Ahora que tenemos remoteDescription, podemos volcar ICE pendientes
    await flushPendingRemoteCandidates();
  }

  // ------------------------------------------
  // Recibe ICE candidate remoto
  // ------------------------------------------
  async function handleRemoteIceCandidate(candidate) {
    if (!candidate) {
      log(
        "[RTC] Candidate remoto null (fin de candidatos)."
      );
      return;
    }

    // Si aún no hay PC o aún no tenemos remoteDescription,
    // lo guardamos en buffer para aplicarlo después
    if (!pc || !pc.remoteDescription) {
      log(
        "[RTC] handleRemoteIceCandidate: aún sin pc o sin remoteDescription, bufereando candidate remoto."
      );
      pendingRemoteCandidates.push(candidate);
      return;
    }

    try {
      log("[RTC] Añadiendo candidate remoto…");
      // Igual que en flushPendingRemoteCandidates: lo pasamos tal cual
      await pc.addIceCandidate(candidate);
    } catch (err) {
      console.error(
        "[RTC] Error al añadir ICE candidate remoto:",
        err
      );
    }
  }

  // ------------------------------------------
  // Manejar mensaje genérico de señalización
  // (tú decides el formato externo; aquí asumimos
  //  que llega como {kind: "offer"/"answer"/"ice", ...})
  // ------------------------------------------
  async function handleSignalMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    const { kind } = msg;

    switch (kind) {
      case "offer":
        log("[RTC] handleSignalMessage: offer recibida.");
        if (msg.sdp) {
          await handleRemoteOffer(msg.sdp);
        }
        break;
      case "answer":
        log("[RTC] handleSignalMessage: answer recibida.");
        if (msg.sdp) {
          await handleRemoteAnswer(msg.sdp);
        }
        break;
      case "ice":
        log("[RTC] handleSignalMessage: ice recibida.");
        if (msg.candidate) {
          await handleRemoteIceCandidate(msg.candidate);
        }
        break;
      default:
        log(
          "[RTC] handleSignalMessage: kind desconocido:",
          kind
        );
        break;
    }
  }

  // ------------------------------------------
  // Detener todo (llamada + cámara/mic)
  // ------------------------------------------
  function stopAll() {
    log("[RTC] stopAll()");

    try {
      if (pc) {
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.oniceconnectionstatechange = null;
        pc.onsignalingstatechange = null;
        pc.close();
      }
    } catch (err) {
      console.warn("[RTC] Error al cerrar pc:", err);
    }
    pc = null;

    if (localStream) {
      log(
        "[RTC] stopAll(): deteniendo tracks locales."
      );
      localStream.getTracks().forEach((t) => t.stop());
    }
    localStream = null;

    // El remoteStream se corta solo al cerrar pc, pero lo limpiamos
    remoteStream = null;
    pendingRemoteCandidates = [];

    isCaller = false;
    isStarted = false;
  }

  // ------------------------------------------
  // Helpers públicos
  // ------------------------------------------
  function getState() {
    return {
      isCaller,
      isStarted,
      hasLocalStream: !!localStream,
      hasRemoteStream: !!remoteStream,
      connectionState: pc ? pc.connectionState : "closed",
      iceConnectionState: pc ? pc.iceConnectionState : "closed",
      signalingState: pc ? pc.signalingState : "closed",
    };
  }

  function getLocalStream() {
    return localStream || null;
  }

  function getRemoteStream() {
    return remoteStream || null;
  }

  // API pública del controlador
  return {
    // flujo principal
    startLocalMedia,
    startAsCaller,
    handleSignalMessage,
    stopAll,

    // helpers
    getState,
    getLocalStream,
    getRemoteStream,
  };
}
