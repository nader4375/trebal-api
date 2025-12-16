import express from "express";
import constitution from "./src/core/constitution.js";

const app = express();

app.get("/", (req, res) => {
  res.json({
    status: "Trebal API running",
    constitutionVersion: constitution.version,
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Trebal API listening on port ${PORT}`);
});
