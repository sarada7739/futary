import { healthGetContract } from "./health";

export const contract = {
  health: {
    get: healthGetContract,
  },
};

export type Contract = typeof contract;
