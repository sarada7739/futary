import { healthGetContract } from "./health";
import { meGetContract } from "./me";

export const contract = {
  health: {
    get: healthGetContract,
  },
  me: {
    get: meGetContract,
  },
};

export type Contract = typeof contract;
