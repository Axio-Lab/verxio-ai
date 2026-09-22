import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    hundred: { executor: "constant-vus", vus: 100, duration: "30s", startTime: "0s" },
    thousand: { executor: "constant-vus", vus: 1000, duration: "30s", startTime: "40s" },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
  },
};

const base = __ENV.VERXIO_BASE_URL || "http://127.0.0.1:8787";

export default function () {
  const health = http.get(`${base}/api/health`);
  check(health, { "health ok": (r) => r.status === 200 });
  sleep(1);
}
