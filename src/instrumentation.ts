export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getModbusScanService } = await import("@/server/modbus-scan/service");
    await getModbusScanService().initialize();
  }
}
