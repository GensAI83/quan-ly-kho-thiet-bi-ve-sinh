import { transferWarehouse } from "./cloud-transfer";

// Credentials arrive through stdin, never command-line arguments or files.
try {
  const input = JSON.parse(await Bun.stdin.text());
  if (typeof input.sourceDatabase !== "string" || typeof input.origin !== "string" || typeof input.password !== "string") throw new Error("Thiếu thông tin chuyển dữ liệu.");
  console.log(await transferWarehouse(input));
  console.log("Từ bây giờ hãy dùng địa chỉ kho online trên cả điện thoại và máy tính. Bản offline trên D không tự đồng bộ với máy chủ.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Không chuyển được dữ liệu.");
  process.exitCode = 1;
}
