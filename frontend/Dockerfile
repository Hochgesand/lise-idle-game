# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Frontend image — Lise Dev Idle Game (Phaser 4 + TypeScript, Vite 8)
# Task T056 (front-loaded from Phase 6 so a deploy can run after each phase).
#
# Multi-stage build:
#   Stage 1 (builder) → node:22-alpine  builds the Vite production bundle.
#   Stage 2 (runtime) → nginx:alpine    serves the static dist/ on :80.
#
# Base images verified to exist on Docker Hub via `docker manifest inspect`:
#   node:22-alpine  (Node 22+ is the documented minimum in quickstart.md)
#   nginx:alpine    (tiny static-file runtime; Traefik targets port 80)
#
# The runtime serves ONLY static files. The backend API runs on a separate
# Traefik host (lise-game-api.schmitz.gg); the SPA resolves the API base URL
# at runtime via its own config/env (wired in T030 REST client), so there is
# no nginx reverse-proxy to the API here.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: build the Vite production bundle ───────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /build

# Copy package.json + the lockfile FIRST so `npm ci` is its own cached layer
# (rebuilds are fast when only source changes). package-lock.json is present,
# so npm ci is the correct reproducible install command.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the project and build. `npm run build` = `tsc -b && vite build`
# (per package.json), which emits dist/index.html + hashed dist/assets/*.js|css.
COPY . .
RUN npm run build

# ── Stage 2: serve the static bundle with nginx ─────────────────────────────
FROM nginx:alpine
WORKDIR /usr/share/nginx/html

# Replace the default nginx config with our SPA-fallback config.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/nginx.conf

# Copy ONLY the built output into the nginx html root.
COPY --from=builder /build/dist/ /usr/share/nginx/html/

# nginx default port — matches the Traefik label
# loadbalancer.server.port=80 in docker-compose.yml.
EXPOSE 80
