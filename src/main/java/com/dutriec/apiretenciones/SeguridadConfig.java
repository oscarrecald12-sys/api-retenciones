package com.dutriec.apiretenciones;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * Provee el codificador BCrypt sin activar toda la cadena de filtros de
 * Spring Security. Solo necesitamos hashear y verificar contraseñas.
 *
 * Requiere la dependencia (ver INSTRUCCIONES_LOGIN.md):
 *   org.springframework.security:spring-security-crypto
 */
@Configuration
public class SeguridadConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        // El "10" es el work factor. 10-12 es el rango recomendado.
        return new BCryptPasswordEncoder(10);
    }
}