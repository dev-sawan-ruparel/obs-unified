# JVM (Java / Kotlin) — OpenTelemetry + obs-unified

The OpenTelemetry Java agent + ~30 lines of stamping code is enough to ship
every signal type into obs-unified. No first-party JVM SDK is required (or
planned today).

## Install

```xml
<!-- pom.xml -->
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-api</artifactId>
    <version>1.43.0</version>
</dependency>
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-sdk</artifactId>
    <version>1.43.0</version>
</dependency>
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-exporter-otlp</artifactId>
    <version>1.43.0</version>
</dependency>
```

Plus the auto-instrumentation javaagent for HTTP / DB / RPC coverage:

```bash
java \
  -javaagent:opentelemetry-javaagent.jar \
  -Dotel.exporter.otlp.endpoint=https://obs.example.com \
  -Dotel.exporter.otlp.headers="Authorization=Bearer ${OBS_INGEST_KEY}" \
  -Dotel.resource.attributes="service.name=checkout-api,project.id=acme" \
  -jar app.jar
```

## interaction_id — stamp inbound

```java
// ObsInteraction.java
package com.example.obs;

import io.opentelemetry.api.trace.Span;
import java.util.regex.Pattern;

public final class ObsInteraction {
    public static final String HEADER = "x-obs-interaction";
    public static final String ATTRIBUTE = "obs.interaction.id";
    private static final Pattern PATTERN =
        Pattern.compile("^[0-9A-HJKMNP-TV-Z]{26}$");

    private ObsInteraction() {}

    /** Reads the header and stamps the active span. No-op on miss/malformed. */
    public static void stamp(Span span, String headerValue) {
        if (span == null || !span.isRecording()) return;
        if (headerValue == null || !PATTERN.matcher(headerValue).matches()) return;
        span.setAttribute(ATTRIBUTE, headerValue);
    }
}
```

### Spring Boot filter

```java
@Component
public class InteractionFilter implements jakarta.servlet.Filter {
    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest http = (HttpServletRequest) req;
        ObsInteraction.stamp(
            Span.current(),
            http.getHeader(ObsInteraction.HEADER));
        chain.doFilter(req, res);
    }
}
```

### Ktor (Kotlin)

```kotlin
import io.ktor.server.application.*
import io.opentelemetry.api.trace.Span

val InteractionPlugin = createApplicationPlugin("ObsInteraction") {
    onCall { call ->
        val span = Span.current()
        if (!span.isRecording) return@onCall
        val raw = call.request.headers["x-obs-interaction"] ?: return@onCall
        if (!Regex("^[0-9A-HJKMNP-TV-Z]{26}\$").matches(raw)) return@onCall
        span.setAttribute("obs.interaction.id", raw)
    }
}
```

## AI calls

OpenInference's attribute conventions translate identically. Stamp
`openinference.span.kind=LLM`, `gen_ai.system`, `gen_ai.request.model`,
`gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` on the span that wraps
the LLM call.

## Auto-instrumentation packs

- `io.opentelemetry.instrumentation:opentelemetry-spring-boot-autoconfigure`
- `io.opentelemetry.instrumentation:opentelemetry-jdbc`
- `io.opentelemetry.instrumentation:opentelemetry-apache-httpclient-5.0`
- ktor, micronaut, quarkus all have official instrumentation modules.

The collector receives plain OTLP — nothing JVM-specific is required on the
server side.
