# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Backend image — Lise Dev Idle Game (Spring Boot 4.1, Java 25)
# Task T055 (front-loaded from Phase 6 so a deploy can run after each phase).
#
# Base-image choice:
#   Build stage   → eclipse-temurin:25-jdk   (full JDK for the Maven build;
#                     Ubuntu/noble base keeps the shell `mvnw` wrapper happy
#                     and lets it fall back to a Java-based Maven download).
#   Runtime stage → eclipse-temurin:25-jre-alpine (smallest 25 JRE; Spring Boot
#                     4.1 needs Java 17+, we target 25). Verified to exist on
#                     Docker Hub via `docker manifest inspect`.
#
# The build uses the project's own Maven wrapper (`mvnw` + `.mvn/`), which
# downloads Maven 3.9.16 on demand. No `-o` (offline) flag so the build is
# robust on a fresh dependency cache.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: build the fat JAR ──────────────────────────────────────────────
FROM eclipse-temurin:25-jdk AS builder
WORKDIR /build

# Copy the build descriptor + Maven wrapper FIRST so dependency resolution is
# its own cached layer (rebuilds are fast when only src changes).
COPY pom.xml ./
COPY .mvn/ ./.mvn/
COPY mvnw ./
RUN chmod +x mvnw \
    && ./mvnw -B dependency:go-offline

# Now copy sources and build the executable (repackaged) fat JAR.
COPY src ./src
RUN ./mvnw -B clean package -DskipTests

# ── Stage 2: minimal runtime ────────────────────────────────────────────────
# Smallest available Java 25 runtime. Alpine musl is fine for a pure-JVM app.
FROM eclipse-temurin:25-jre-alpine
WORKDIR /app

# Copy ONLY the built fat JAR to a stable path. Spring Boot's repackage goal
# replaces target/lise-idle-backend-0.0.1-SNAPSHOT.jar in place (the original
# is renamed to *.jar.original), so the wildcard resolves to exactly one jar.
COPY --from=builder /build/target/*-SNAPSHOT.jar /app/app.jar

# Run as a non-root user (security best practice). The bind-mounted /data
# volume (set up in docker-compose.yml) is where H2/Postgres files live at
# runtime; nothing is baked into this image.
RUN addgroup -S lise && adduser -S lise -G lise \
    && chown -R lise:lise /app
USER lise

# Spring Boot default port — matches application.yml (server.port: 8080) and
# the Traefik label loadbalancer.server.port=8080.
EXPOSE 8080

# Default profile is `prod`; docker-compose.yml sets this too and adds the
# file-based H2 datasource pointing at the bind-mounted /data.
ENV SPRING_PROFILES_ACTIVE=prod

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
