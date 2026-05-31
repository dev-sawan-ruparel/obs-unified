# .NET — OpenTelemetry + obs-unified

`System.Diagnostics.Activity` + the OpenTelemetry .NET SDK is enough to ship
every signal type into obs-unified.

## Install

```bash
dotnet add package OpenTelemetry
dotnet add package OpenTelemetry.Extensions.Hosting
dotnet add package OpenTelemetry.Exporter.OpenTelemetryProtocol
dotnet add package OpenTelemetry.Instrumentation.AspNetCore
dotnet add package OpenTelemetry.Instrumentation.Http
```

## Wire OTel at startup

```csharp
// Program.cs
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r
        .AddService(serviceName: "checkout-api")
        .AddAttributes(new Dictionary<string, object>
        {
            ["project.id"] = Environment.GetEnvironmentVariable("PROJECT_ID") ?? ""
        }))
    .WithTracing(t => t
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddOtlpExporter(opts =>
        {
            opts.Endpoint = new Uri(
                $"{Environment.GetEnvironmentVariable("OBS_COLLECTOR_URL")}/v1/traces");
            opts.Headers = $"Authorization=Bearer {Environment.GetEnvironmentVariable("OBS_INGEST_KEY")}";
        }));

var app = builder.Build();
```

## interaction_id — middleware

```csharp
// ObsInteractionMiddleware.cs
using System.Diagnostics;
using System.Text.RegularExpressions;

public class ObsInteractionMiddleware
{
    private const string Header = "x-obs-interaction";
    private const string Attribute = "obs.interaction.id";
    private static readonly Regex IdPattern =
        new("^[0-9A-HJKMNP-TV-Z]{26}$", RegexOptions.Compiled);

    private readonly RequestDelegate _next;

    public ObsInteractionMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext ctx)
    {
        if (ctx.Request.Headers.TryGetValue(Header, out var raw) &&
            IdPattern.IsMatch(raw!) &&
            Activity.Current is { IsAllDataRequested: true } a)
        {
            a.SetTag(Attribute, raw.ToString());
        }
        await _next(ctx);
    }
}

// Program.cs
app.UseMiddleware<ObsInteractionMiddleware>();
```

`Activity.Current` is what OTel's .NET SDK exposes as the active span. The
middleware MUST run after the AspNetCore instrumentation so the request
`Activity` has already been created.

## AI calls

```csharp
using var activity = ActivitySource.StartActivity("openai.chat.completions");
activity?.SetTag("openinference.span.kind", "LLM");
activity?.SetTag("gen_ai.system", "openai");
activity?.SetTag("gen_ai.request.model", model);

var response = await openai.GetChatCompletionsAsync(request);

activity?.SetTag("gen_ai.usage.input_tokens", response.Usage.PromptTokens);
activity?.SetTag("gen_ai.usage.output_tokens", response.Usage.CompletionTokens);
```

## What you give up vs. a first-party SDK

Manual middleware registration; manual `ActivitySource` plumbing for AI calls
(instead of typed `withLLMSpan` helpers). Every signal flows through OTel/OTLP
identically — the collector treats your traces no differently than the
first-party SDKs'.
