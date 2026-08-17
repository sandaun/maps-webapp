import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: ["temp/**", ".next/**", "node_modules/**", ".local-data/**"] },
];

export default config;
