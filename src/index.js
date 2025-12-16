import express from "express";
import constitution from "./core/constitution.js";

const app = express();

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    constitutionVersion: constitution.version,
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
