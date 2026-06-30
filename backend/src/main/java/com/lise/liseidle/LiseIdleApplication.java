package com.lise.liseidle;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Entry point for the Lise Dev Idle Game backend.
 *
 * <p>The backend is responsible for durable persistence, multi-device sync,
 * and serving versioned content/balance JSON (see plan.md + contracts §2/§3).
 * It does NOT run the idle tick — the pure {@code advance} simulation lives
 * client-side in TypeScript (Constitution Principle I/IV).
 */
@SpringBootApplication
public class LiseIdleApplication {

    public static void main(String[] args) {
        SpringApplication.run(LiseIdleApplication.class, args);
    }

}
