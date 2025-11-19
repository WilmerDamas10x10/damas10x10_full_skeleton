// src/ui/pages/Training/editor/template.js
export function getEditorTemplate(turn){
  return `
<div class="card editor-card" data-page="editor">
  <div class="layout-editor editor-layout">

    <!-- DOCK DE TURNO (columna izquierda en Grid) -->
    <!-- ✅ Se eliminan el título "Turno" y el badge; se conserva el botón -->
    <div class="dock-turno" id="turn-dock">
      <div class="turn-card">
        <button id="btn-cambiar-turno" type="button" class="btn-cambiar-turno">
          Cambiar turno
        </button>
      </div>
    </div><!-- /dock-turno -->

    <!-- BOARD (columna central en Grid) -->
    <div id="board"></div>

    <!-- SIDEBAR (columna derecha en Grid) -->
    <aside class="sidebar">
      <!-- ❌ Eliminado: línea que mostraba "Turno: <b id='turn'>..." -->
      <!-- <div style="margin:6px 0">Turno: <b id="turn">\${turn}</b></div> -->

      <div id="tools" class="toolbar-vertical">
        <!-- ▼ Selector de variante de reglas (clásica/internacional) -->
        <div class="variant-select" style="display:flex; gap:.5rem; align-items:center; margin-inline: .25rem;">
          <label for="variantSelect" class="sr-only">Variante</label>
          <select id="variantSelect" aria-label="Variante de reglas">
            <option value="clasica">Clásica</option>
            <option value="internacional" selected>Internacional</option>
          </select>
        </div>
        <!-- ▲ Selector de variante de reglas -->

        <button id="btn-inicial" class="btn btn-icon" type="button">
          <span class="ico ico--icono_posicioninicial_tablero" aria-hidden="true"></span>
          <span>Posición Inicial</span>
        </button>

        <button id="btn-vaciar" class="btn btn-icon" type="button">
          <span class="ico ico--icono_vaciar_tablero" aria-hidden="true"></span>
          <span>Vaciar Tablero</span>
        </button>

        <!-- ✅ Botones Agregar con iconos -->
        <button id="btn-add-w" class="btn btn-icon" type="button" title="Agregar ficha Blanca">
          <span class="ico ico--add-white" aria-hidden="true"></span>
          <span>Agregar</span>
        </button>
        <button id="btn-add-b" class="btn btn-icon" type="button" title="Agregar ficha Negra">
          <span class="ico ico--add-black" aria-hidden="true"></span>
          <span>Agregar</span>
        </button>
        <button id="btn-add-W" class="btn btn-icon" type="button" title="Agregar Dama Blanca">
          <span class="ico ico--add-wk" aria-hidden="true"></span>
          <span>Agregar</span>
        </button>
        <button id="btn-add-B" class="btn btn-icon" type="button" title="Agregar Dama Negra">
          <span class="ico ico--add-bk" aria-hidden="true"></span>
          <span>Agregar</span>
        </button>
        <!-- /Agregar -->

        <button id="btn-borrar" class="btn btn-icon" type="button">
          <span class="ico ico--icono_borrador" aria-hidden="true"></span>
          <span>Borrador</span>
        </button>

        <button id="btn-undo" class="btn btn-icon" type="button" disabled>
          <span class="ico ico--deshacer" aria-hidden="true"></span>
          <span>Deshacer</span>
        </button>

        <button id="btn-redo" class="btn btn-icon" type="button" disabled>
          <span class="ico ico--edicion_rehacer" aria-hidden="true"></span>
          <span>Rehacer</span>
        </button>

        <a id="btn-menu" class="btn btn-icon" href="/">
          <span class="ico ico--icono_volver_menu" aria-hidden="true"></span>
          <span>Volver al menú</span>
        </a>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 12px">
        <!-- Botón 'Compartir posición (WAN)' eliminado intencionalmente -->

        <!-- 🆕 Descargar .FEN -->
        <button id="btn-download-fen" class="btn btn-icon" type="button" title="Descargar archivo .fen">
          <span class="ico ico--icono_descargar" aria-hidden="true"></span>
          <span>Descargar .FEN</span>
        </button>

        <!-- 🆕 Copiar FEN -->
        <button id="btn-copy-fen" class="btn btn-icon" type="button" title="Copiar FEN al portapapeles">
          <span class="ico ico--icono_copiar" aria-hidden="true"></span>
          <span>Copiar FEN</span>
        </button>

        <!-- 🧹 Texto “La WAN solo conecta al compartir.” eliminado -->
      </div>
    </aside>

  </div>
</div>
  `;
}
