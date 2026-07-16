package com.dutriec.apiretenciones;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Autenticación por login + token de sesión en memoria.
 *
 * Rutas:
 *   POST /auth/login          body: { "username":"...", "password":"..." }
 *                             -> { token, id, username, nombre, rol }
 *   POST /auth/logout         header: X-Auth-Token
 *   GET  /auth/me             header: X-Auth-Token  -> datos de la sesión
 *   POST /auth/hash           (SOLO SOPORTE) body: { "password":"..." }
 *                             -> { "hash":"..." }  para dar de alta usuarios
 *
 * IMPORTANTE — sesión en memoria:
 *   Las sesiones viven en un mapa en RAM. Si reiniciás el backend, todos
 *   deben volver a loguearse. Es lo más simple y suficiente para una app
 *   interna de un equipo chico. Si más adelante corrés varias instancias,
 *   migrá a JWT firmado o a una tabla `sesiones` en MariaDB (el esquema
 *   está comentado al final de INSTRUCCIONES_LOGIN.md).
 */
@RestController
@RequestMapping("/auth")
@CrossOrigin(origins = "*")
public class AuthController {

    private final JdbcTemplate mariaDb;
    private final PasswordEncoder encoder;

    // token -> sesión (en memoria)
    private static final Map<String, Sesion> SESIONES = new ConcurrentHashMap<>();
    private static final long DURACION_MS = 8L * 60 * 60 * 1000; // 8 horas
    private static final SecureRandom RNG = new SecureRandom();

    public AuthController(@Qualifier("mariadbJdbcTemplate") JdbcTemplate mariaDb,
                          PasswordEncoder encoder) {
        this.mariaDb = mariaDb;
        this.encoder = encoder;
    }

    // ---- estructura de sesión ----
    static class Sesion {
        Integer id;
        String  username;
        String  nombre;
        String  rol;
        long    expiraEn;
        Sesion(Integer id, String username, String nombre, String rol, long expiraEn) {
            this.id = id; this.username = username; this.nombre = nombre;
            this.rol = rol; this.expiraEn = expiraEn;
        }
    }

    private String nuevoToken() {
        byte[] b = new byte[32];
        RNG.nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    /** Devuelve la sesión válida asociada al token, o null si no existe/expiró. */
    public static Sesion sesionDe(String token) {
        if (token == null) return null;
        Sesion s = SESIONES.get(token);
        if (s == null) return null;
        if (Instant.now().toEpochMilli() > s.expiraEn) {
            SESIONES.remove(token);
            return null;
        }
        return s;
    }

    // =====================================================================
    // POST /auth/login
    // =====================================================================
    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody Map<String, String> body) {
        String username = body.get("username");
        String password = body.get("password");

        if (username == null || username.isBlank() || password == null || password.isBlank()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Usuario y contraseña son obligatorios."));
        }

        List<Map<String, Object>> filas = mariaDb.queryForList(
            "SELECT id, username, nombre, rol, activo, password_hash " +
            "FROM usuarios WHERE username = ? LIMIT 1",
            username
        );

        // Mensaje genérico para no revelar si el usuario existe
        if (filas.isEmpty()) {
            return ResponseEntity.status(401).body(Map.of("error", "Usuario o contraseña incorrectos."));
        }

        Map<String, Object> u = filas.get(0);
        // 'activo' es TINYINT(1): el driver de MariaDB puede devolverlo como
        // Boolean o como Number según la versión. Lo normalizamos.
        Object activoRaw = u.get("activo");
        boolean estaActivo;
        if (activoRaw instanceof Boolean) {
            estaActivo = (Boolean) activoRaw;
        } else if (activoRaw instanceof Number) {
            estaActivo = ((Number) activoRaw).intValue() == 1;
        } else {
            estaActivo = "1".equals(String.valueOf(activoRaw)) || "true".equalsIgnoreCase(String.valueOf(activoRaw));
        }
        if (!estaActivo) {
            return ResponseEntity.status(403).body(Map.of("error", "Usuario inactivo. Contactá a soporte."));
        }

        String hash = String.valueOf(u.get("password_hash"));
        if (!encoder.matches(password, hash)) {
            return ResponseEntity.status(401).body(Map.of("error", "Usuario o contraseña incorrectos."));
        }

        Integer id  = ((Number) u.get("id")).intValue();
        String nom  = u.get("nombre") != null ? String.valueOf(u.get("nombre")) : "";
        String rol  = String.valueOf(u.get("rol"));

        String token = nuevoToken();
        SESIONES.put(token, new Sesion(id, username, nom, rol,
                Instant.now().toEpochMilli() + DURACION_MS));

        // Auditamos el login (best-effort)
        try {
            mariaDb.update(
                "INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, detalle) " +
                "VALUES (?, 'LOGIN', 'usuario', ?, NULL)",
                id, String.valueOf(id));
        } catch (Exception ignore) {}

        return ResponseEntity.ok(Map.of(
            "token", token,
            "id", id,
            "username", username,
            "nombre", nom,
            "rol", rol
        ));
    }

    // =====================================================================
    // GET /auth/me  — valida el token y devuelve la sesión
    // =====================================================================
    @GetMapping("/me")
    public ResponseEntity<?> me(@RequestHeader(value = "X-Auth-Token", required = false) String token) {
        Sesion s = sesionDe(token);
        if (s == null) {
            return ResponseEntity.status(401).body(Map.of("error", "Sesión inválida o expirada."));
        }
        return ResponseEntity.ok(Map.of(
            "id", s.id, "username", s.username, "nombre", s.nombre, "rol", s.rol
        ));
    }

    // =====================================================================
    // POST /auth/logout
    // =====================================================================
    @PostMapping("/logout")
    public ResponseEntity<?> logout(@RequestHeader(value = "X-Auth-Token", required = false) String token) {
        if (token != null) SESIONES.remove(token);
        return ResponseEntity.ok(Map.of("mensaje", "Sesión cerrada."));
    }

    // =====================================================================
    // POST /auth/hash  (SOLO SOPORTE) — genera el hash para dar de alta
    // Body: { "password":"..." }  header: X-Auth-Token de un SOPORTE
    // Devuelve el hash que luego se manda a POST /retenciones/usuarios.
    // =====================================================================
    @PostMapping("/hash")
    public ResponseEntity<?> generarHash(
            @RequestBody Map<String, String> body,
            @RequestHeader(value = "X-Auth-Token", required = false) String token) {

        Sesion s = sesionDe(token);
        if (s == null || !"SOPORTE".equalsIgnoreCase(s.rol)) {
            return ResponseEntity.status(403).body(Map.of("error", "Solo soporte puede generar hashes."));
        }
        String password = body.get("password");
        if (password == null || password.length() < 6) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "La contraseña debe tener al menos 6 caracteres."));
        }
        return ResponseEntity.ok(Map.of("hash", encoder.encode(password)));
    }
}