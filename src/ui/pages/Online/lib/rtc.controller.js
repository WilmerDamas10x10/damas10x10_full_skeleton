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

const DEFAULT_RTC_CONFIG = {
  iceServers: [
    // STUN público. Para LAN va sobrado.
    { urls: "stun:stun.l.google.com:19302" },
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
      pc = null;
    }

    if (pc) return pc;

    log("[RTC] Creando RTCPeerConnection…");
    pc = new RTCPeerConnection(DEFAULT_RTC_CONFIG);

    // Cuando lleguen tracks remotos (video/audio)
    pc.ontrack = (event) => {
      log("[RTC] ontrack remoto", event.streams);
      const [stream] = event.streams || [];
      if (stream) {
        remoteStream = stream;
        if (typeof onRemoteStream === "function") {
          onRemoteStream(stream);
        }
      }
    };

    // Envío de candidates (hielo) al otro peer
    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        log("[RTC] onicecandidate: fin de candidatos");
        return;
      }
      log("[RTC] onicecandidate: enviando candidate");
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
        log("[RTC] Conexión RTC fallida, se recomienda stopAll()");
      }
    };

    pc.oniceconnectionstatechange = () => {
      log("[RTC] iceConnectionState:", pc.iceConnectionState);
    };

    return pc;
  }

  // ------------------------------------------
  // Iniciar cámara/micrófono local
  // ------------------------------------------
  async function startLocalMedia(constraints = { video: true, audio: true }) {
    if (localStream) {
      log("[RTC] Local stream ya existe, reutilizando.");
      if (typeof onLocalStream === "function") onLocalStream(localStream);
      return localStream;
    }

    log("[RTC] Solicitando getUserMedia…", constraints);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStream = stream;
      log("[RTC] getUserMedia OK");

      if (typeof onLocalStream === "function") {
        onLocalStream(stream);
      }

      // Si ya hay PeerConnection, añadimos pistas
      if (pc) {
        stream.getTracks().forEach((track) => {
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
    if (!pc || !localStream) return;

    const senders = pc.getSenders();
    const existingTracks = senders.map((s) => s.track).filter(Boolean);

    localStream.getTracks().forEach((track) => {
      const already = existingTracks.find((t) => t.kind === track.kind);
      if (already) {
        log("[RTC] Track local ya añadido:", track.kind);
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
    if (!pc || !pc.remoteDescription) return;
    if (!pendingRemoteCandidates.length) return;

    const queue = pendingRemoteCandidates;
    pendingRemoteCandidates = [];

    for (const candidate of queue) {
      try {
        log("[RTC] Añadiendo candidate remoto (buffered)…");
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error("[RTC] Error al añadir ICE candidate remoto (buffered):", err);
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
    await connection.setLocalDescription(offer);

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

    log("[RTC] Callee: recibiendo offer…");
    const desc = new RTCSessionDescription({ type: "offer", sdp });
    await connection.setRemoteDescription(desc);

    // ⚠️ IMPORTANTE:
    // El CALLEE **NO** enciende cámara/mic automáticamente.
    // Solo adjunta pistas locales si YA tiene un stream local (por ejemplo,
    // si el usuario activó su propio micrófono/cámara manualmente).
    if (localStream) {
      attachLocalTracks();
    }

    log("[RTC] Callee: creando answer…");
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);

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
      console.warn("[RTC] handleRemoteAnswer sin pc. Ignorando.");
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

    log("[RTC] Caller: recibiendo answer…");
    const desc = new RTCSessionDescription({ type: "answer", sdp });
    await pc.setRemoteDescription(desc);

    // Ahora que tenemos remoteDescription, podemos volcar ICE pendientes
    await flushPendingRemoteCandidates();
  }

  // ------------------------------------------
  // Recibe ICE candidate remoto
  // ------------------------------------------
  async function handleRemoteIceCandidate(candidate) {
    if (!candidate) {
      log("[RTC] Candidate remoto null (fin de candidatos).");
      return;
    }

    // Si aún no hay PC o aún no tenemos remoteDescription,
    // lo guardamos en buffer para aplicarlo después
    if (!pc || !pc.remoteDescription) {
      log("[RTC] handleRemoteIceCandidate: aún sin remoteDescription, bufereando candidate remoto.");
      pendingRemoteCandidates.push(candidate);
      return;
    }

    try {
      log("[RTC] Añadiendo candidate remoto…");
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error("[RTC] Error al añadir ICE candidate remoto:", err);
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
        if (msg.sdp) {
          await handleRemoteOffer(msg.sdp);
        }
        break;
      case "answer":
        if (msg.sdp) {
          await handleRemoteAnswer(msg.sdp);
        }
        break;
      case "ice":
        if (msg.candidate) {
          await handleRemoteIceCandidate(msg.candidate);
        }
        break;
      default:
        log("[RTC] handleSignalMessage: kind desconocido:", kind);
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
        pc.close();
      }
    } catch (err) {
      console.warn("[RTC] Error al cerrar pc:", err);
    }
    pc = null;

    if (localStream) {
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
