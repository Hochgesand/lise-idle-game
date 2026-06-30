package com.lise.liseidle;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;

/**
 * Smoke test verifying the JUnit 5 + Spring Boot Test wiring and that the
 * application context loads (T005). A {@code @SpringBootTest} with no body
 * asserts the Spring context starts; the explicit {@code assertDoesNotThrow}
 * documents the intent.
 */
@SpringBootTest
class LiseIdleApplicationTest {

    @Test
    void contextLoads() {
        assertDoesNotThrow(() -> {
            // Verifies the Spring context starts; the real context-load
            // assertion is provided by @SpringBootTest.
        });
    }
}
