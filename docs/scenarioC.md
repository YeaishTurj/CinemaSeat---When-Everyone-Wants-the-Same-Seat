# Scenario C — Find your breakpoint

Scenario C is optional bonus work and was **not attempted**. No throughput or
p95 claim is made without a separate load generator and measured evidence.

The expected first bottleneck is PostgreSQL connection/lock contention on hot
seat rows, followed by the single API instance's CPU or memory. That remains a
hypothesis until a proper ramp test is run from outside the application host.
