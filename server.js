"use strict";

require("dotenv").config();
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const express = require("express");

const app = express();
app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public")));

// Browsers permit camera access on http://localhost. Existing development
// certificates are still used automatically when both files are available.
const keyPath = path.join(__dirname, "certs", "create-ca-key.pem");
const certPath = path.join(__dirname, "certs", "create-ca.pem");
const useHttps = process.env.LOCAL_HTTP_ONLY !== "1" && fs.existsSync(keyPath) && fs.existsSync(certPath);
const server = useHttps
  ? https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app)
  : http.createServer(app);

server.listen(process.env.PORT || 4000, () => {
  console.log(`Facialytics Studio is ready at ${useHttps ? "https" : "http"}://localhost:${server.address().port}`);
});
