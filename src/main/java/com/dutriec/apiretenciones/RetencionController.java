package com.dutriec.apiretenciones;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * Controlador de acciones con control de rol.
 *
 * VERSION 2 - El rol ya NO se lee de un header falsificable. Se resuelve
 * desde la sesion asociada al token (X-Auth-Token) que emite AuthController.
 * Esto cierra el agujero de que un cliente mande "X-Usuario-Rol: JEFE" a mano.
 *
 * Rutas:
 *   POST /retenciones/revertir/{id}         -> solo JEFE
 *   GET  /retenciones/auditoria/incidencias -> solo SOPORTE
 *   GET  /retenciones/usuarios              -> solo SOPORTE
 *   POST /retenciones/usuarios              -> solo SOPORTE
 *   PUT  /retenciones/usuarios/{id}         -> solo SOPORTE
 *
 * Autenticacion: header  X-Auth-Token: <token del login>
 */
@RestController
@RequestMapping("/retenciones")
@CrossOrigin(origins = "*")
public class RetencionController {

    private final JdbcTemplate mariaDb;

    public RetencionController(@Qualifier("mariadbJdbcTemplate") JdbcTemplate mariaDb) {
        this.mariaDb = mariaDb;
    }

    private void auditar(Integer usuarioId, String accion, String entidad,
                         String entidadId, String detalle) {
        try {
            mariaDb.update(
                "INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, detalle) " +
                "VALUES (?, ?, ?, ?, ?)",
                usuarioId, accion, entidad, entidadId, detalle
            );
        } catch (Exception e) {
            System.err.println("[auditoria] no se pudo registrar: " + e.getMessage());
        }
    }

    // Devuelve null si OK; devuelve un ResponseEntity de error si no autorizado.
    private ResponseEntity<?> chequear(AuthController.Sesion s, String rolRequerido) {
        if (s == null) {
            return ResponseEntity.status(401).body(Map.of("error", "Sesion invalida o expirada. Volve a iniciar sesion."));
        }
        if (!rolRequerido.equalsIgnoreCase(s.rol)) {
            return ResponseEntity.status(403).body(Map.of("error", "Tu rol no permite esta accion."));
        }
        return null;
    }

    // =====================================================================
    // POST /retenciones/revertir/{id}   (SOLO JEFE)
    // =====================================================================
    @PostMapping("/revertir/{id}")
    public ResponseEntity<?> revertir(
            @PathVariable Long id,
            @RequestBody Map<String, String> body,
            @RequestHeader(value = "X-Auth-Token", required = false) String token) {

        AuthController.Sesion s = AuthController.sesionDe(token);
        ResponseEntity<?> err = chequear(s, "JEFE");
        if (err != null) return err;

        String motivo = body != null ? body.get("motivo") : null;
        if (motivo == null || motivo.isBlank()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "El motivo de la reversion es obligatorio."));
        }

        int filas = mariaDb.update(
            "UPDATE retenciones_enviadas " +
            "SET estado = 'REVERTIDA', " +
            "    veces_revertida = veces_revertida + 1, " +
            "    revertido_por = ?, " +
            "    motivo_reversion = ?, " +
            "    fecha_reversion = NOW(), " +
            "    fecha_actualizacion = NOW() " +
            "WHERE id = ? AND estado = 'APROBADO'",
            s.id, motivo, id
        );

        if (filas == 0) {
            return ResponseEntity.status(409)
                .body(Map.of("error", "La factura no existe o no esta en estado APROBADO."));
        }

        auditar(s.id, "REVERTIR", "retencion", String.valueOf(id), motivo);

        return ResponseEntity.ok(Map.of(
            "mensaje", "Factura revertida. Ya puede re-descargarse el TXT."
        ));
    }

    // =====================================================================
    // GET /retenciones/auditoria/incidencias   (SOLO SOPORTE)
    // =====================================================================
    @GetMapping("/auditoria/incidencias")
    public ResponseEntity<?> incidencias(
            @RequestHeader(value = "X-Auth-Token", required = false) String token) {

        AuthController.Sesion s = AuthController.sesionDe(token);
        ResponseEntity<?> err = chequear(s, "SOPORTE");
        if (err != null) return err;

        List<Map<String, Object>> filas = mariaDb.queryForList(
            "SELECT id, nro_comprobante, razon_social, estado, " +
            "       veces_revertida, veces_rechazada, " +
            "       (veces_revertida + veces_rechazada) AS total_incidencias, " +
            "       motivo_reversion, fecha_reversion, fecha_actualizacion " +
            "FROM retenciones_enviadas " +
            "WHERE veces_revertida > 0 OR veces_rechazada > 0 " +
            "ORDER BY total_incidencias DESC, fecha_actualizacion DESC"
        );
        return ResponseEntity.ok(filas);
    }

    // =====================================================================
    // GET /retenciones/usuarios   (SOLO SOPORTE)
    // =====================================================================
    @GetMapping("/usuarios")
    public ResponseEntity<?> listarUsuarios(
            @RequestHeader(value = "X-Auth-Token", required = false) String token) {

        AuthController.Sesion s = AuthController.sesionDe(token);
        ResponseEntity<?> err = chequear(s, "SOPORTE");
        if (err != null) return err;

        List<Map<String, Object>> usuarios = mariaDb.queryForList(
            "SELECT id, username, nombre, rol, activo, fecha_creacion " +
            "FROM usuarios ORDER BY rol, username"
        );
        return ResponseEntity.ok(usuarios);
    }

    // =====================================================================
    // POST /retenciones/usuarios   (SOLO SOPORTE) - crear usuario
    // Body: { "username", "password_hash", "nombre", "rol" }
    // El hash se obtiene primero de POST /auth/hash.
    // =====================================================================
    @PostMapping("/usuarios")
    public ResponseEntity<?> crearUsuario(
            @RequestBody Map<String, String> body,
            @RequestHeader(value = "X-Auth-Token", required = false) String token) {

        AuthController.Sesion s = AuthController.sesionDe(token);
        ResponseEntity<?> err = chequear(s, "SOPORTE");
        if (err != null) return err;

        String username = body.get("username");
        String hash     = body.get("password_hash");
        String nombre   = body.get("nombre");
        String nuevoRol = body.get("rol");

        boolean rolValido = nuevoRol != null &&
            (nuevoRol.equalsIgnoreCase("SOPORTE") ||
             nuevoRol.equalsIgnoreCase("JEFE") ||
             nuevoRol.equalsIgnoreCase("ASISTENTE"));

        if (username == null || username.isBlank() ||
            hash == null || hash.isBlank() || !rolValido) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "username, password_hash y un rol valido son obligatorios."));
        }

        Integer existe = mariaDb.queryForObject(
            "SELECT COUNT(*) FROM usuarios WHERE username = ?", Integer.class, username);
        if (existe != null && existe > 0) {
            return ResponseEntity.status(409)
                .body(Map.of("error", "Ya existe un usuario con ese username."));
        }

        mariaDb.update(
            "INSERT INTO usuarios (username, password_hash, nombre, rol, activo, creado_por) " +
            "VALUES (?, ?, ?, ?, 1, ?)",
            username, hash, nombre, nuevoRol.toUpperCase(), s.id
        );

        auditar(s.id, "CREAR_USUARIO", "usuario", username, "rol=" + nuevoRol);
        return ResponseEntity.ok(Map.of("mensaje", "Usuario creado."));
    }

    // =====================================================================
    // PUT /retenciones/usuarios/password   (SOLO SOPORTE) - cambiar clave
    // Body: { "username", "password_hash" }
    // El hash se genera antes con POST /auth/hash.
    // =====================================================================
    @PutMapping("/usuarios/password")
    public ResponseEntity<?> cambiarPassword(
            @RequestBody Map<String, String> body,
            @RequestHeader(value = "X-Auth-Token", required = false) String token) {

        AuthController.Sesion s = AuthController.sesionDe(token);
        ResponseEntity<?> err = chequear(s, "SOPORTE");
        if (err != null) return err;

        String username = body.get("username");
        String hash     = body.get("password_hash");

        if (username == null || username.isBlank() || hash == null || hash.isBlank()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "username y password_hash son obligatorios."));
        }

        int filas = mariaDb.update(
            "UPDATE usuarios SET password_hash = ? WHERE username = ?",
            hash, username
        );

        if (filas == 0) {
            return ResponseEntity.status(404).body(Map.of("error", "Usuario no encontrado."));
        }

        auditar(s.id, "CAMBIAR_PASSWORD", "usuario", username, null);
        return ResponseEntity.ok(Map.of("mensaje", "Contraseña actualizada."));
    }

    // =====================================================================
    // PUT /retenciones/usuarios/{id}   (SOLO SOPORTE) - editar rol/activo
    // Body: { "rol", "activo", "nombre" }
    // =====================================================================
    @PutMapping("/usuarios/{id}")
    public ResponseEntity<?> editarUsuario(
            @PathVariable Integer id,
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = "X-Auth-Token", required = false) String token) {

        AuthController.Sesion s = AuthController.sesionDe(token);
        ResponseEntity<?> err = chequear(s, "SOPORTE");
        if (err != null) return err;

        String nuevoRol = body.get("rol") != null ? String.valueOf(body.get("rol")) : null;
        if (nuevoRol != null &&
            !(nuevoRol.equalsIgnoreCase("SOPORTE") ||
              nuevoRol.equalsIgnoreCase("JEFE") ||
              nuevoRol.equalsIgnoreCase("ASISTENTE"))) {
            return ResponseEntity.badRequest().body(Map.of("error", "Rol invalido."));
        }

        Object activoObj = body.get("activo");
        Integer activo = activoObj == null ? null : (Boolean.parseBoolean(String.valueOf(activoObj)) ? 1 : 0);
        String nombre = body.get("nombre") != null ? String.valueOf(body.get("nombre")) : null;

        // Evitar que soporte se auto-desactive por error
        if (activo != null && activo == 0 && id.equals(s.id)) {
            return ResponseEntity.badRequest().body(Map.of("error", "No podes desactivar tu propia cuenta."));
        }

        int filas = mariaDb.update(
            "UPDATE usuarios SET " +
            "rol    = COALESCE(?, rol), " +
            "activo = COALESCE(?, activo), " +
            "nombre = COALESCE(?, nombre) " +
            "WHERE id = ?",
            nuevoRol == null ? null : nuevoRol.toUpperCase(), activo, nombre, id
        );

        if (filas == 0) {
            return ResponseEntity.status(404).body(Map.of("error", "Usuario no encontrado."));
        }

        auditar(s.id, "EDITAR_USUARIO", "usuario", String.valueOf(id),
                "rol=" + nuevoRol + " activo=" + activo);
        return ResponseEntity.ok(Map.of("mensaje", "Usuario actualizado."));
    }
}