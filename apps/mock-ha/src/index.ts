import { startMockHa } from "./mock";
startMockHa(Number(process.env.PORT ?? 8123), process.env.MOCK_HA_TOKEN ?? "dev-token");
console.log("mock HA on :8123");
