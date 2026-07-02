package com.lise.liseidle.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

/**
 * PROVISIONAL permit-all SecurityConfig.
 *
 * <p>Adding {@code spring-boot-starter-security} to the classpath without a
 * {@link SecurityFilterChain} bean activates Spring Security's auto-config,
 * which installs a default chain that locks down EVERY endpoint (default
 * generated user, form login, HTTP Basic, CSRF). On the running server that
 * would break the Spec 001 anonymous surface — {@code GET /api/v1/content},
 * {@code POST /api/v1/session}, {@code PUT /api/v1/session/**}, and the
 * {@code /ws} handshake all return a {@code 401}/login redirect instead of
 * the anonymous 200s FR-002 requires. This provisional chain re-opens the
 * entire surface so the 001 experience — and the existing backend test
 * suite — stays GREEN at this commit.
 *
 * <p>PROVISIONAL permit-all — mirrors the 001 anonymous surface; replaced by
 * the real rules in T030 (T015 tests). Do NOT add CORS/OAuth2 here yet
 * (those land in T030).
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
        return http.build();
    }
}
