package com.lise.liseidle.security;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

/**
 * Real {@code SecurityConfig} for the Shared Office Co-op feature (T030;
 * RED tests in T015). Replaces the T002 provisional permit-all chain with the
 * binding configuration from contracts.md &sect;2 "Security configuration".
 *
 * <h2>What this config does</h2>
 * <ul>
 *   <li><b>OAuth2 resource server</b> validating {@code LiseIdler}-issued
 *       JWTs against the issuer URI
 *       {@code https://keycloak.novitasoft.de/realms/LiseIdler} (configured in
 *       {@code application.yml} as
 *       {@code spring.security.oauth2.resourceserver.jwt.issuer-uri}). The
 *       backend is stateless: it issues no credential, holds no HTTP session,
 *       and serves no login/logout endpoint (sign-in is an SPA&harr;Keycloak
 *       exchange, contracts &sect;2 "Authentication").</li>
 *   <li><b>Anonymous 001 surface stays open</b> (FR-002): unauthenticated
 *       access to {@code GET /api/v1/content}, {@code POST /api/v1/session},
 *       {@code PUT /api/v1/session/**}, and the {@code /ws} STOMP handshake.
 *       The identity-bound ownership rule (an id bootstrapped under a matching
 *       bearer then requires that bearer even on these routes) is enforced in
 *       {@code SessionController} (T031) &mdash; <i>not</i> here; this config
 *       only authenticates the bearer where required and permits the surface
 *       for ids never claimed by an identity.</li>
 *   <li><b>Bearer required</b> on {@code /api/v1/me} and
 *       {@code /api/v1/presence/**}; every other unlisted path defaults to
 *       {@code anyRequest().authenticated()} (nothing becomes anonymously
 *       reachable by omission).</li>
 *   <li><b>{@code dev} profile carve-out</b>: under the {@code dev} profile
 *       {@code /api/v1/dev/**} is permitted without a token (the endpoints are
 *       {@code @Profile("dev")} and do not exist in prod &mdash; the quickstart
 *       seeder depends on this); outside {@code dev} they fall through to
 *       {@code authenticated()}.</li>
 *   <li><b>CSRF disabled</b> (the bearer is an explicit per-request header, not
 *       an ambient cookie credential, so there is nothing for a CSRF attacker
 *       to ride) and <b>sessions STATELESS</b>.</li>
 *   <li><b>CORS</b> ({@link #corsConfigurationSource}) allowlists the prod
 *       frontend, the Vite dev server, and the local compose frontend with the
 *       {@code Authorization} header permitted so authenticated cross-origin
 *       calls preflight cleanly (no credentialed CORS &mdash; the token travels
 *       in an explicit header).</li>
 *   <li><b>401 envelope</b>: a tokenless (or invalid) request to a
 *       bearer-required route returns the contracts error envelope
 *       {@code {"error":{"code":"not_authenticated",...}}} rather than Spring's
 *       default HTML. The {@code player_mismatch} 403 is produced by
 *       {@code SessionController} (T031) as a JSON body, not by a security
 *       handler.</li>
 * </ul>
 *
 * <p>{@code @EnableScheduling} lives on {@code LiseIdleApplication} so later
 * {@code @Scheduled} presence sweeps (T054/T085) run.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    /** JSON body for a 401 (contracts &sect;2 error envelope, {@code not_authenticated}). */
    private static final String NOT_AUTHENTICATED_BODY =
            "{\"error\":{\"code\":\"not_authenticated\","
                    + "\"message\":\"A valid bearer token is required for this endpoint.\"}}";

    /** CORS allowlist (contracts &sect;2 "CORS"). */
    private static final List<String> CORS_ALLOWED_ORIGINS = List.of(
            "https://lise-game.schmitz.gg",
            "http://localhost:5173",
            "http://localhost:8087");

    /** Methods the cross-origin SPA may use against the API. */
    private static final List<String> CORS_ALLOWED_METHODS =
            List.of("GET", "POST", "PUT", "DELETE");

    /** Headers the cross-origin SPA may send; {@code Authorization} is the binding one. */
    private static final List<String> CORS_ALLOWED_HEADERS =
            List.of("Authorization", "Content-Type");

    /**
     * The real security filter chain.
     *
     * @param http the {@link HttpSecurity} to configure
     * @param env  the Spring environment (used to detect the {@code dev} profile)
     * @return the configured filter chain
     * @throws Exception if the chain cannot be built
     */
    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, ConfigurableEnvironment env)
            throws Exception {
        boolean devProfileActive = env.matchesProfiles("dev");

        // 401 entry point shared by BOTH failure paths so they return the
        // contracts error envelope (not Spring's default bare 401):
        //   (1) tokenless → ExceptionTranslationFilter (anonymous hit on an
        //       authenticated() route) uses exceptionHandling().authenticationEntryPoint;
        //   (2) invalid/expired bearer → the resource server's
        //       BearerTokenAuthenticationFilter uses its own entry point, which
        //       must be the SAME handler or token expiry (a routine client
        //       event) yields a body the SPA cannot parse (contracts §2:
        //       "missing, expired, or invalid" → not_authenticated).
        AuthenticationEntryPoint jsonAuthenticationEntryPoint = (request, response, authException) -> {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setHeader("WWW-Authenticate", "Bearer");
            response.getWriter().write(NOT_AUTHENTICATED_BODY);
        };

        http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .cors(Customizer.withDefaults())
            .oauth2ResourceServer(oauth2 -> oauth2
                .authenticationEntryPoint(jsonAuthenticationEntryPoint)
                .jwt(Customizer.withDefaults()))
            .authorizeHttpRequests(auth -> {
                // Anonymous 001 surface (FR-002) — ids never claimed by an
                // identity; the identity-bound ownership rule is in SessionController.
                auth.requestMatchers(HttpMethod.GET, "/api/v1/content").permitAll();
                auth.requestMatchers(HttpMethod.POST, "/api/v1/session").permitAll();
                auth.requestMatchers(HttpMethod.PUT, "/api/v1/session/**").permitAll();
                auth.requestMatchers("/ws", "/ws/**").permitAll();
                // Bearer required.
                auth.requestMatchers("/api/v1/me").authenticated();
                auth.requestMatchers("/api/v1/presence/**").authenticated();
                // dev-profile carve-out (T066 seeder); absent in prod.
                if (devProfileActive) {
                    auth.requestMatchers("/api/v1/dev/**").permitAll();
                }
                // Nothing becomes anonymously reachable by omission.
                auth.anyRequest().authenticated();
            })
            // 401 (tokenless path) → contracts error envelope.
            .exceptionHandling(eh -> eh.authenticationEntryPoint(jsonAuthenticationEntryPoint));

        return http.build();
    }

    /**
     * CORS allowlist for the three SPA origins with the {@code Authorization}
     * header permitted. Credentialed CORS is not used (the token travels in an
     * explicit header), so {@code allowCredentials} stays false and the origins
     * are listed explicitly rather than via a wildcard.
     *
     * @return the {@link CorsConfigurationSource} consumed by
     *         {@code http.cors(Customizer.withDefaults())}
     */
    @Bean
    CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(CORS_ALLOWED_ORIGINS);
        config.setAllowedMethods(CORS_ALLOWED_METHODS);
        config.setAllowedHeaders(CORS_ALLOWED_HEADERS);
        config.setAllowCredentials(false);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
