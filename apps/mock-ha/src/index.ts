import { startMockHa } from "./mock";
const port = Number(process.env.PORT ?? 8123);
// MOCK_HA_DEMO=1 fills the home with areas, labels, more kinds of device and answers for energy, logbook and traces.
startMockHa(port, process.env.MOCK_HA_TOKEN ?? "dev-token", { demo: process.env.MOCK_HA_DEMO === "1" });
console.log(`mock HA on :${port}`);
