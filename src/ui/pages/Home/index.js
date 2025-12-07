// ================================
// src/ui/pages/Home/index.js
// Menú principal + Editor en overlay full-screen (sin barra superior)
// Variante por defecto: Clásica Ecuatoriana
// ================================

import { navigate } from "@router";
import "../../design.css";
import { setupAccordions, pulse } from "../../design-utils.js";
import { setRulesVariant } from "../../../engine/policies/config.js";

import "./home.grid.css";
import "./home.grid.js";
import "./home.buttons.css";

import { registrarUsuario, iniciarSesion } from "../../api/usuarios.api.js";
import { playHover, playClick } from "../../efectosSonido.js";

function toast(msg = "", ms = 1600) {
  try {
    let host = document.getElementById("toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "toast-host";
      host.style.position = "fixed";
      host.style.left = "50%";
      host.style.bottom = "18px";
      host.style.transform = "translateX(-50%)";
      host.style.zIndex = "9999";
      host.style.display = "flex";
      host.style.flexDirection = "column";
      host.style.gap = "8px";
      document.body.appendChild(host);
    }
    const el = document.createElement("div");
    el.textContent = msg;
    el.style.padding = "10px 14px";
    el.style.borderRadius = "10px";
    el.style.background = "rgba(0,0,0,.8)";
    el.style.color = "#fff";
    el.style.fontSize = "14px";
    el.style.boxShadow = "0 6px 18px rgba(0,0,0,.25)";
    el.style.maxWidth = "80vw";
    el.style.textAlign = "center";
    el.style.backdropFilter = "blur(2px)";
    el.style.transition = "opacity .18s ease";
    el.style.opacity = "0";
    host.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = "1";
    });
    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 180);
    }, ms);
  } catch {}
}

// ==== Helper de prefetch en hover (Soplo / Online / IA) ====
function prefetchOnHover(el, loader) {
  if (!el || typeof loader !== "function") return;
  let done = false;
  const run = async () => {
    if (done) return;
    done = true;
    try {
      await loader();
    } catch (err) {
      console.error("[Prefetch] Error al precargar:", err);
    }
  };
  el.addEventListener("mouseenter", run, { once: true });
  el.addEventListener("touchstart", run, { once: true, passive: true });
}

export default function Home(container) {
  container.style.minHeight = "100vh";
  document.documentElement.style.height = "100%";
  document.body.style.height = "100%";
  document.body.style.margin = "0";

  // 🔵 Fondo directo en el BODY (marca de agua)
  Object.assign(document.body.style, {
    backgroundImage: "url('/images/fondo-menu.png')",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundAttachment: "fixed",
    backgroundColor: "#EAF6FF",
  });

  const appRoot =
    document.getElementById("app") || document.getElementById("root");
  if (appRoot) {
    appRoot.style.background = "transparent";
  }

  // Log para comprobar que la imagen carga bien
  try {
    const imgTest = new Image();
    imgTest.src = "/images/fondo-menu.png";
    imgTest.onload = () => console.log("[Home] Fondo cargado OK");
    imgTest.onerror = (e) =>
      console.error("[Home] Error cargando /images/fondo-menu.png", e);
  } catch {}

  container.style.background = "transparent";

  // 🧽 Limpia cualquier saludo viejo flotante
  const viejoSaludo = document.getElementById("saludo-usuario");
  if (viejoSaludo && !container.contains(viejoSaludo)) {
    viejoSaludo.remove();
  }

  // CSS para que el saludo SIEMPRE esté debajo del título y centrado
  let saludoStyle = document.getElementById("home-saludo-style");
  if (!saludoStyle) {
    saludoStyle = document.createElement("style");
    saludoStyle.id = "home-saludo-style";
    document.head.appendChild(saludoStyle);
  }
  saludoStyle.textContent = `
  .home-saludo-wrap {
    display:flex;
    justify-content:center;
    margin-top: 0;
    margin-bottom: 0; /* CERO separación */
    padding: 0;
  }

  #saludo-usuario {
    position: static !important;
    display: inline-block;
    padding: 10px 22px !important;
    background: linear-gradient(135deg, #0094ff, #00b7ff);
    color: white !important;
    font-size: 1rem;
    font-weight: 600;
    border-radius: 18px;
    border: 3px solid rgba(255, 255, 255, 0.6);
    box-shadow: 0 6px 20px rgba(0, 140, 255, 0.4);
    transition: transform 0.15s ease, box-shadow 0.2s ease;
  }

  #saludo-usuario:hover {
    transform: translateY(-2px) scale(1.03);
    box-shadow: 0 10px 26px rgba(0, 140, 255, 0.55);
  }

  #saludo-usuario:active {
    transform: scale(0.97);
  }
`;

  // 👇 leer usuario actual (si ya inició sesión, en esta pestaña)
  const currentUser = window.__D10_USER__ || null;
  const bienvenidaHTML = currentUser
    ? `
      <span id="saludo-usuario">
        Hola, ${currentUser.name} 👋
      </span>
    `
    : `
      <span id="saludo-usuario">
        Inicia sesión para guardar tu progreso.
      </span>
    `;

  container.innerHTML = `
    <div class="design-scope pad-4" style="max-width:920px;margin:0 auto;" data-page="home">
      <div class="col gap-3">
        <h1 style="text-align: center; margin: 0 0 0px; font-weight: 700;">Reino de las Damas</h1>

        <div class="home-saludo-wrap">
          ${bienvenidaHTML}
        </div>

        <div class="card" style="padding:10px 12px;">
          <div class="row" style="gap:12px; align-items:center;">
            <label for="homeVariant" style="min-width:84px;">Variante</label>
            <select id="homeVariant" class="btn" style="padding:8px 10px;">
              <option value="clasica">Clásica Ecuatoriana</option>
              <option value="internacional">Internacional</option>
            </select>
            <span id="variantBadge" class="btn btn--subtle" style="pointer-events:none;">Actual: Clásica Ecuatoriana</span>
          </div>
        </div>

        <div class="acc card">
          <button class="acc__hdr" data-acc>
            <span class="row space" style="width:100%;">
              <span>Jugar</span>
              <span class="chev">▶</span>
            </span>
          </button>
          <div class="acc__panel" data-acc-panel>
            <div class="acc__inner col gap-2">

              <div class="acc">
                <button class="acc__hdr" data-acc>
                  <span class="row space" style="width:100%;">
                    <span>Modo Rápido</span>
                    <span class="chev">▶</span>
                  </span>
                </button>
                <div class="acc__panel" data-acc-panel>
                  <div class="acc__inner col gap-2 two-col">
                    <button class="btn btn-menu-principal" id="btn-quick-play">Jugar Rápido</button>
                    <button class="btn btn-menu-principal" id="btn-quick-room">Crear Sala</button>
                    <button class="btn btn-menu-principal" id="btn-quick-ai">Jugar contra la IA</button>
                    <button class="btn btn-menu-principal" id="btn-quick-league" title="mini torneo todos contra todos">Liga Exprés</button>
                    <button class="btn btn-menu-principal" id="btn-quick-editor">Editor / Modo Entrenamiento</button>
                  </div>
                </div>
              </div>

              <div class="acc">
                <button class="acc__hdr" data-acc>
                  <span class="row space" style="width:100%;">
                    <span>Soplo / Online</span>
                    <span class="chev">▶</span>
                  </span>
                </button>
                <div class="acc__panel" data-acc-panel>
                  <div class="acc__inner col gap-2 two-col">
                    <button class="btn btn-menu-principal" id="btn-classic-local">Jugar con Soplo</button>
                    <button class="btn btn-menu-principal" id="btn-classic-online">Jugar Online</button>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>

        <div class="acc card">
          <button class="acc__hdr" data-acc>
            <span class="row space" style="width:100%;">
              <span>Clasificadas (ELO)</span>
              <span class="chev">▶</span>
            </span>
          </button>
          <div class="acc__panel" data-acc-panel>
            <div class="acc__inner col gap-2 two-col">
              <button class="btn btn-menu-principal" id="btn-elo-queue">Buscar Partida ELO</button>
              <button class="btn btn-menu-principal" id="btn-elo-rated">Partida Calificada ELO</button>
              <button class="btn btn-menu-principal" id="btn-elo-top">Mi Ranking TOP</button>
            </div>
          </div>
        </div>

        <div class="acc card">
          <button class="acc__hdr" data-acc>
            <span class="row space" style="width:100%;">
              <span>Social</span>
              <span class="chev">▶</span>
            </span>
          </button>
          <div class="acc__panel" data-acc-panel>
            <div class="acc__inner col gap-2 two-col">
              <button class="btn btn-menu-principal" id="btn-social-feed">Noticias / Feed</button>
              <button class="btn btn-menu-principal" id="btn-social-friends">Amigos</button>
              <button class="btn btn-menu-principal" id="btn-social-clubs">Clubs</button>
            </div>
          </div>
        </div>

        <div class="acc card">
          <button class="acc__hdr" data-acc>
            <span class="row space" style="width:100%;">
              <span>Registro, Perfil y Ajuste</span>
              <span class="chev">▶</span>
            </span>
          </button>
          <div class="acc__panel" data-acc-panel>
            <div class="acc__inner col gap-2 two-col">
              <button class="btn btn-menu-principal" id="btn-account">Cuenta</button>
              <button class="btn btn-menu-principal" id="btn-login">Iniciar sesión</button>
              <button class="btn btn-menu-principal" id="btn-register">Registrarse</button>
              <button class="btn btn-menu-principal" id="btn-recover">Recuperar contraseña</button>
              <button class="btn btn-menu-principal" id="btn-profile">Perfil</button>
              <button class="btn btn-menu-principal" id="btn-settings">Ajustes</button>
              <button class="btn btn-menu-principal" id="btn-themes">Temas</button>
            </div>
          </div>
        </div>

      </div>
    </div>
  `;

  setupAccordions(container);

  // 🔊 Sonido hover + click en TODOS los botones .btn
  try {
    container.querySelectorAll(".btn").forEach((btn) => {
      btn.addEventListener("mouseenter", () => {
        playHover();
      });
      btn.addEventListener(
        "touchstart",
        () => {
          playHover();
        },
        { passive: true }
      );
      btn.addEventListener("click", () => {
        playClick();
      });
    });
  } catch (err) {
    console.warn("[Home] No se pudo enganchar sonido hover/click:", err);
  }

  // ===== Variante reglas =====
  (() => {
    const sel = container.querySelector("#homeVariant");
    const badge = container.querySelector("#variantBadge");
    if (!sel) return;
    const apply = (v) => {
      try {
        setRulesVariant?.(v);
      } catch {}
      try {
        window.dispatchEvent(
          new CustomEvent("rules:variant-changed", { detail: { variant: v } })
        );
      } catch {}
      if (badge)
        badge.textContent =
          "Actual: " + (v === "internacional" ? "Internacional" : "Clásica Ecuatoriana");
    };
    sel.value = "clasica";
    apply("clasica");
    sel.addEventListener("change", () => {
      const v = sel.value === "internacional" ? "internacional" : "clasica";
      apply(v);
    });
  })();

  const go = (path, fallbackMsg) => {
    try {
      if (typeof navigate === "function") navigate(path);
      else location.hash = `#${path}`;
    } catch {
      toast(fallbackMsg || "Acción no disponible");
    }
  };

  // JUGAR → Modo Rápido
  container.querySelector("#btn-quick-play")?.addEventListener("click", (e) => {
    pulse(e.currentTarget);
    go("/play?mode=quick", "Jugar Rápido");
  });
  container.querySelector("#btn-quick-room")?.addEventListener("click", (e) => {
    pulse(e.currentTarget);
    go("/rooms/create", "Crear Sala");
  });

  // JUGAR → Modo Rápido → IA
  container.querySelector("#btn-quick-ai")?.addEventListener("click", (e) => {
    try {
      pulse(e.currentTarget);
    } catch {}
    navigate("/ai");
  });

  container.querySelector("#btn-quick-league")?.addEventListener("click", (e) => {
    pulse(e.currentTarget);
    go("/tournaments/league-express", "Liga Exprés");
  });

  // === SOPLO / ONLINE ===
  container
    .querySelector("#btn-classic-local")
    ?.addEventListener("click", (e) => {
      try {
        pulse?.(e.currentTarget);
      } catch {}
      navigate("/soplo");
    });

  container
    .querySelector("#btn-classic-online")
    ?.addEventListener("click", (e) => {
      try {
        pulse?.(e.currentTarget);
      } catch {}
      navigate("/online");
    });

  // Nuevo: Soplo Modo Libre (si existe botón)
  const btnSoploLibre = container.querySelector("#btn-soplo-libre");
  if (btnSoploLibre) {
    btnSoploLibre.addEventListener("click", async (e) => {
      try {
        pulse?.(e.currentTarget);

        const mod = await import("../SoploLibre/index.js");
        const mount =
          (typeof mod === "function" && mod) ||
          (typeof mod?.default === "function" && mod.default) ||
          (typeof mod?.mountSoploLibre === "function" && mod.mountSoploLibre) ||
          (typeof mod?.default?.default === "function" && mod.default.default) ||
          (typeof mod?.mount === "function" && mod.mount) ||
          (typeof mod?.start === "function" && mod.start) ||
          null;

        if (!mount) {
          throw new TypeError(
            "El módulo SoploLibre no exporta una función de montaje"
          );
        }

        const appRoot2 = document.getElementById("app") || document.body;
        await mount(appRoot2);
      } catch (err) {
        console.error("[Home] No se pudo abrir Soplo Modo Libre:", err);
        toast("No se pudo abrir Soplo Modo Libre. Revisa la consola.");
      }
    });
  }

  // ===== Editor / Modo Entrenamiento — overlay FULL SCREEN
  container
    .querySelector("#btn-quick-editor")
    ?.addEventListener("click", async (e) => {
      pulse(e.currentTarget);
      try {
        let overlay = document.getElementById("editor-overlay");
        if (!overlay) {
          overlay = document.createElement("div");
          overlay.id = "editor-overlay";
          overlay.style.position = "fixed";
          overlay.style.inset = "0";
          overlay.style.zIndex = "9998";
          overlay.style.background = "rgba(0,0,0,.85)";
          overlay.style.display = "flex";
          overlay.style.alignItems = "stretch";
          overlay.style.justifyContent = "stretch";
          overlay.style.backdropFilter = "blur(2px)";
          document.body.appendChild(overlay);
        } else {
          overlay.innerHTML = "";
          overlay.style.display = "flex";
        }

        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        const shell = document.createElement("div");
        shell.id = "editor-shell";
        shell.style.width = "100vw";
        shell.style.height = "100vh";
        shell.style.display = "flex";
        shell.style.flexDirection = "column";
        shell.style.borderRadius = "0";
        shell.style.boxShadow = "none";
        shell.style.background = "var(--bg)";

        const host = document.createElement("div");
        host.id = "editor-host";
        host.style.flex = "1";
        host.style.minHeight = "0";
        host.style.overflow = "hidden";

        const fitCss = document.createElement("style");
        fitCss.textContent = `
        #editor-host .layout-editor{ min-height:100%; height:100%; padding:12px; box-sizing:border-box; }
        #editor-host .area-center{ min-height:0; }
        #editor-host #board{ max-height:calc(100vh - 120px); }
        #editor-host .variant-badge, #editor-host [data-variant-badge], #editor-host .variant-crumb{ display:none !important; }
      `;
        shell.appendChild(fitCss);

        shell.appendChild(host);
        overlay.appendChild(shell);

        overlay.addEventListener("click", (ev) => {
          if (ev.target === overlay) {
            overlay.style.display = "none";
            overlay.innerHTML = "";
            document.body.style.overflow = prevOverflow;
          }
        });

        const onKey = (ev) => {
          if (ev.key === "Escape") {
            overlay.style.display = "none";
            overlay.innerHTML = "";
            document.body.style.overflow = prevOverflow;
            window.removeEventListener("keydown", onKey);
          }
        };
        window.addEventListener("keydown", onKey);

        const mod = await import("../Training/editor/Editor.js");
        if (typeof mod.default === "function") {
          mod.default(host);
        } else {
          throw new Error("Editor.js no exporta default()");
        }
      } catch (err) {
        console.error("[Home] No se pudo abrir el Editor]:", err);
        toast("No se pudo abrir el Editor. Revisa la consola.");
      }
    });

  // ===== Clasificadas (ELO)
  container.querySelector("#btn-elo-queue")?.addEventListener("click", (e) => {
    pulse(e.currentTarget);
    go("/ranked/queue", "Buscar Partida ELO");
  });
  container
    .querySelector("#btn-elo-rated")
    ?.addEventListener("click", (e) => {
      pulse(e.currentTarget);
      go("/ranked/rated", "Partida Calificada ELO");
    });
  container.querySelector("#btn-elo-top")?.addEventListener("click", (e) => {
    pulse(e.currentTarget);
    go("/ranked/top", "Mi Ranking TOP");
  });

  // ===== Ajustes y Perfil
  container.querySelector("#btn-account")?.addEventListener("click", (e) => {
    pulse(e.currentTarget);
    go("/account", "Cuenta");
  });
  container.querySelector("#btn-recover")?.addEventListener("click", (e) => {
    pulse(e.currentTarget);
    go("/auth/recover", "Recuperar contraseña");
  });
  container.querySelector("#btn-profile")?.addEventListener("click", (e) => {
    pulse(e.currentTarget);
    go("/profile", "Perfil");
  });
  container.querySelector("#btn-settings")?.addEventListener("click", (e) => {
    pulse(e.currentTarget);
    go("/settings", "Ajustes");
  });
  container.querySelector("#btn-themes")?.addEventListener("click", (e) => {
    pulse(e.currentTarget);
    go("/themes", "Temas");
  });

  // ===== Prefetch en hover (Soplo / Online / IA) =====
  try {
    const btnSoplo = container.querySelector("#btn-classic-local");
    const btnOnline = container.querySelector("#btn-classic-online");
    const btnSoploLibreHover = container.querySelector("#btn-soplo-libre");

    prefetchOnHover(btnSoplo, async () => {
      await import("../SoploLibre/index.js");
    });
    prefetchOnHover(btnSoploLibreHover, async () => {
      await import("../SoploLibre/index.js");
    });

    const btnAI = container.querySelector("#btn-quick-ai");
    prefetchOnHover(btnAI, async () => {
      await import("../AI/index.js");
    });
  } catch (e) {
    // Silencioso
  }

  // ==============================
  // 🔐 INTEGRACIÓN CON BACKEND PYTHON
  // ==============================

  const btnLogin = container.querySelector("#btn-login");
  const saludoEl = container.querySelector("#saludo-usuario");

  function aplicarEstadoSesion(usuario) {
    if (!saludoEl) return;

    console.log("[Home] aplicarEstadoSesion →", usuario);

    // Aseguramos layout correcto siempre
    saludoEl.style.position = "static";
    saludoEl.style.top = "";
    saludoEl.style.right = "";
    saludoEl.style.marginTop = "6px";
    saludoEl.style.display = "inline-block";

    if (usuario) {
      saludoEl.textContent = `Hola, ${usuario.name} 👋`;
      saludoEl.style.background = "#0094FF";
      saludoEl.style.color = "#fff";
      saludoEl.style.fontWeight = "600";

      if (btnLogin) {
        btnLogin.textContent = "Cerrar sesión";
        btnLogin.style.backgroundColor = "green";
        btnLogin.style.color = "white";
      }
    } else {
      saludoEl.textContent = "Inicia sesión para guardar tu progreso.";
      saludoEl.style.background = "#00AEEF";
      saludoEl.style.color = "#fff";
      saludoEl.style.fontWeight = "500";

      if (btnLogin) {
        btnLogin.textContent = "Iniciar sesión";
        btnLogin.style.backgroundColor = "";
        btnLogin.style.color = "";
      }
    }
  }

  aplicarEstadoSesion(currentUser);

  const btnRegister = container.querySelector("#btn-register");
  if (btnRegister) {
    btnRegister.addEventListener("click", async (e) => {
      try {
        pulse(e.currentTarget);

        const nombre = window.prompt("Nombre:");
        if (!nombre) return;

        const email =
          window.prompt(
            "Correo electrónico (puede dejar vacío si usa teléfono):"
          ) || null;
        const telefono =
          window.prompt(
            "Teléfono (puede dejar vacío si usa correo):"
          ) || null;

        if (!email && !telefono) {
          toast("Debes ingresar email o teléfono.");
          return;
        }

        const ciudad = window.prompt("Ciudad (opcional):") || null;
        const provincia = window.prompt("Provincia (opcional):") || null;
        const password = window.prompt("Contraseña:") || "";

        if (!password) {
          toast("Debes ingresar una contraseña.");
          return;
        }

        const usuario = await registrarUsuario({
          name: nombre,
          city: ciudad,
          province: provincia,
          email,
          phone: telefono, // 👈 CLAVE: usar "phone" (no "telefono")
          profile_photo_url: null,
          password,
        });

        window.__D10_USER__ = usuario;
        aplicarEstadoSesion(usuario);

        toast(`Usuario registrado: ${usuario.name}`);
        console.log("[Usuario] Registrado:", usuario);
      } catch (err) {
        console.error("[Home] Error al registrar usuario:", err);
        toast(err.message || "Error al registrar usuario");
      }
    });
  }

  if (btnLogin) {
    btnLogin.addEventListener("click", async (e) => {
      try {
        pulse(e.currentTarget);

        // Si ya hay usuario → cerrar sesión
        if (window.__D10_USER__) {
          window.__D10_USER__ = null;
          aplicarEstadoSesion(null);
          toast("Sesión cerrada.");
          console.log("[Usuario] Sesión cerrada");
          return;
        }

        const modo = window.prompt(
          "Escribe 1 para entrar con correo, 2 para entrar con teléfono:",
          "1"
        );

        let email = null;
        let phone = null; // 👈 usar mismo nombre que en el backend

        if (modo === "1") {
          email = window.prompt("Correo electrónico:");
          if (!email) {
            toast("Debes ingresar un correo.");
            return;
          }
        } else if (modo === "2") {
          phone = window.prompt("Teléfono:");
          if (!phone) {
            toast("Debes ingresar un teléfono.");
            return;
          }
        } else {
          toast("Opción inválida.");
          return;
        }

        const password = window.prompt("Contraseña:");
        if (!password) {
          toast("Debes ingresar la contraseña.");
          return;
        }

        const usuario = await iniciarSesion({ email, phone, password });

        window.__D10_USER__ = usuario;
        aplicarEstadoSesion(usuario);

        toast(`Sesión iniciada: ${usuario.name}`);
        console.log("[Usuario] Sesión iniciada:", usuario);

        // 👉 Para que "se note" que ya entraste:
        go("/account", "Cuenta");
      } catch (err) {
        console.error("[Home] Error al iniciar sesión:", err);
        toast(err.message || "Error al iniciar sesión");
      }
    });
  }
}
