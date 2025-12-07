// ================================
// src/ui/api/usuarios.api.js
// Cliente simple para el backend de usuarios (FastAPI)
// ================================

const API_BASE =
  (import.meta && import.meta.env && import.meta.env.VITE_BACKEND_URL) ||
  "http://127.0.0.1:8001";

// 🔧 Helper para leer la respuesta y lanzar errores con mensaje legible
async function manejarRespuesta(resp) {
  let data = null;

  try {
    data = await resp.json();
  } catch {
    // si no viene JSON, dejamos data = null
  }

  if (!resp.ok) {
    // Intentar extraer un mensaje útil desde FastAPI
    let detalle = "Error al comunicarse con el servidor";

    if (data) {
      if (Array.isArray(data.detail) && data.detail[0]?.msg) {
        detalle = data.detail[0].msg;
      } else if (typeof data.detail === "string") {
        detalle = data.detail;
      } else if (typeof data.message === "string") {
        detalle = data.message;
      } else {
        // último recurso: stringify corto
        detalle = `Error ${resp.status}`;
      }
    } else {
      detalle = `Error ${resp.status}`;
    }

    const error = new Error(detalle);
    error.status = resp.status;
    error.payload = data;
    throw error; // 👈 esto va al catch() en Home
  }

  return data;
}

// ============================================
//  REGISTRO DE USUARIO
//  (mapeamos payload → modelo backend)
// ============================================
export async function registrarUsuario(payload) {
  // Aceptamos ambos formatos: nuevo y antiguo
  const name = payload.name || payload.nombre || null;
  const city = payload.city || payload.ciudad || null;
  const province = payload.province || payload.provincia || null;
  const email = payload.email || null;
  const phone = payload.phone || payload.telefono || null;
  const profile_photo_url = payload.profile_photo_url || payload.fotoUrl || null;
  const password = payload.password;

  const body = {
    name,
    city,
    province,
    email,
    phone,
    profile_photo_url,
    password,
  };

  console.log("[API] registrarUsuario → body enviado:", JSON.stringify(body));

  const resp = await fetch(`${API_BASE}/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return manejarRespuesta(resp);
}

// ============================================
//  LOGIN
//  (acepta email o teléfono)
// ============================================
export async function iniciarSesion(payload) {
  // Aceptamos ambos formatos: nuevo y antiguo
  const email = payload.email || null;
  const phone = payload.phone || payload.telefono || null;
  const password = payload.password;

  const body = {
    email,
    phone,
    password,
  };

  console.log("[API] iniciarSesion → body enviado:", JSON.stringify(body));

  const resp = await fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return manejarRespuesta(resp);
}
