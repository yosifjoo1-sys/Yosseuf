import fs from "fs";
import os from "os";
import path from "path";
process.env.MRJOO_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "mrjoo-"));
process.env.ACCESS_TOKEN = "test-token-123456";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-for-unit-tests-0000";
