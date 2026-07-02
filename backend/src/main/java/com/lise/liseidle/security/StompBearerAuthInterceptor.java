package com.lise.liseidle.security;

import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.stereotype.Component;

import java.security.Principal;

/**
 * Authenticates the STOMP {@code CONNECT} frame by validating the
 * {@code Authorization: Bearer <access_token>} header against the
 * {@code LiseIdler} issuer and installing a session {@link Principal} whose
 * name is the JWT {@code sub} (the colleague id). Registered on the
 * client-inbound channel by {@code WebSocketConfig} (T032; RED tests in T019b;
 * contracts &sect;3 "WebSocket / STOMP").
 *
 * <p><b>Why the CONNECT frame, not the HTTP handshake</b>: the SPA passes its
 * access token in the STOMP CONNECT headers (contracts &sect;3 "Endpoint"),
 * and the {@code /ws} handshake is deliberately permitted for anonymous
 * (contracts &sect;2 / FR-002 &mdash; the full 001 experience is reachable
 * without sign-in). So there is no HTTP-level {@link Principal} to inherit;
 * the identity is established here, at the STOMP protocol layer, the first
 * time the client identifies itself.
 *
 * <p><b>Installing the {@link Principal}</b>: on a successful decode the
 * principal is set on the inbound CONNECT message's accessor
 * ({@link StompHeaderAccessor#setUser(Principal)}). Spring's
 * {@code StompSubProtocolHandler} then associates it with the WebSocket
 * session, registers it in the {@code SimpUserRegistry} under the
 * {@code sub}, and &mdash; together with the corrected broker prefixes in
 * {@code WebSocketConfig} &mdash; makes {@code convertAndSendToUser} deliverable
 * to the authenticated session.
 *
 * <p><b>Never an ERROR frame</b> (contracts &sect;3, FR-002 &mdash; the 001
 * anonymous-reconnect guarantee): a CONNECT without a token, or with an
 * <i>invalid</i> or <i>expired</i> one, is <b>accepted</b> with <b>no</b>
 * {@link Principal} installed. The socket keeps 001 behavior only: presence
 * destinations deliver nothing to it (no {@link Principal} &rarr; no user
 * destination resolves) and its {@code /app/presence.heartbeat} frames carry
 * no identity (the presence heartbeat handler requires the Principal; T059).
 * Decode failures ({@link JwtException} for a malformed/expired/invalid token)
 * and a missing/malformed {@code Authorization} header are all swallowed into
 * the anonymous case rather than surfaced as an ERROR frame, which would break
 * anonymous reconnect.
 *
 * <p><b>No network in tests</b>: the dependency is the resource-server
 * {@link JwtDecoder} bean, overridden by spring-security-test mock decoders
 * in {@code StompAuthTest}; in prod it is the {@code LiseIdler} issuer decoder.
 * This interceptor issues no credentials and holds no state &mdash; it is a pure
 * function of the CONNECT message.
 */
@Component
public class StompBearerAuthInterceptor implements ChannelInterceptor {

    /** The STOMP CONNECT-frame native header carrying {@code Bearer <access_token>}. */
    static final String AUTHORIZATION_HEADER = "Authorization";

    /** The scheme prefix of a bearer token within the {@code Authorization} header. */
    static final String BEARER_PREFIX = "Bearer ";

    private final JwtDecoder jwtDecoder;

    /**
     * @param jwtDecoder the resource-server JWT decoder (issuer-bound in prod,
     *                   a mock in {@code StompAuthTest})
     */
    public StompBearerAuthInterceptor(JwtDecoder jwtDecoder) {
        this.jwtDecoder = jwtDecoder;
    }

    /**
     * On a {@link StompCommand#CONNECT} frame, validate the bearer token (if
     * any) and install a {@link Principal} named by the {@code sub}. Any other
     * frame passes through unchanged. Never returns {@code null} and never
     * throws &mdash; a bad or absent token yields an accepted, anonymous CONNECT
     * (never an ERROR frame).
     *
     * @param message the inbound STOMP message
     * @param channel the channel the message is being sent to
     * @return the (possibly principal-annotated) message, always non-null
     */
    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null || !StompCommand.CONNECT.equals(accessor.getCommand())) {
            return message;
        }

        Principal principal = resolvePrincipal(accessor.getFirstNativeHeader(AUTHORIZATION_HEADER));
        if (principal != null) {
            accessor.setUser(principal);
        }
        // principal == null → accepted as anonymous (001 behavior), no ERROR frame.
        return message;
    }

    /**
     * Decodes the bearer token (if the header is a well-formed bearer value)
     * into a {@link Principal} named by the {@code sub}. Returns {@code null}
     * for a missing or malformed header and for any decode failure
     * ({@link JwtException} &mdash; invalid signature, wrong issuer, expired),
     * so all of those map uniformly to the accepted anonymous case.
     *
     * @param authorization the raw {@code Authorization} STOMP header value, or {@code null}
     * @return a Principal named by the {@code sub}, or {@code null} if anonymous
     */
    private Principal resolvePrincipal(String authorization) {
        if (authorization == null || !authorization.startsWith(BEARER_PREFIX)) {
            return null;
        }
        String token = authorization.substring(BEARER_PREFIX.length()).trim();
        if (token.isEmpty()) {
            return null;
        }
        try {
            Jwt jwt = jwtDecoder.decode(token);
            String sub = jwt.getSubject();
            if (sub == null || sub.isBlank()) {
                return null;
            }
            final String name = sub;
            return () -> name;
        } catch (Exception e) {
            // Any decode failure &mdash; invalid signature / wrong issuer /
            // expired (JwtException), a blank/malformed token
            // (IllegalArgumentException), or a stray RuntimeException (e.g.
            // an unexpected JWKS-fetch error that Nimbus did not wrap) &mdash;
            // maps to the accepted anonymous case. The class's binding
            // invariant is "never throws": a bad token must degrade to an
            // anonymous CONNECT, never surface as an ERROR frame that would
            // break the 001 anonymous-reconnect guarantee (contracts &sect;3).
            return null;
        }
    }
}
