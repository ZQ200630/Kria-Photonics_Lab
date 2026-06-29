import { invoke } from "@tauri-apps/api/core";
import type { PaStreamDiagnostics } from "../api/types";

export type PaReceiverStatus = {
  connected: boolean;
  running: boolean;
  stop_requested: boolean;
  bytes_received: number;
  blocks_received: number;
  frames_received: number;
  output_path: string;
  last_error: string;
  last_sequence: number;
  endpoint: string;
  phase: string;
  diagnostics: PaStreamDiagnostics;
};

const withTimeout = <T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.finally(() => window.clearTimeout(timer)).then(resolve).catch(reject);
  });

export const paReceiverStartWithTimeout = (
  host: string,
  port: number,
  outputPath: string,
  timeoutMs: number = 10_000,
): Promise<PaReceiverStatus> =>
  withTimeout(
    invoke<PaReceiverStatus>("pa_receiver_start", {
      host,
      port,
      outputPath,
    }),
    "PA receiver start",
    timeoutMs,
  );

export const paReceiverStopWithTimeout = (timeoutMs: number = 10_000): Promise<PaReceiverStatus> =>
  withTimeout(invoke<PaReceiverStatus>("pa_receiver_stop"), "PA receiver stop", timeoutMs);

export const paReceiverStatusWithTimeout = (timeoutMs: number = 10_000): Promise<PaReceiverStatus> =>
  withTimeout(invoke<PaReceiverStatus>("pa_receiver_status"), "PA receiver status", timeoutMs);

export async function paReceiverStart(host: string, port: number, outputPath: string): Promise<PaReceiverStatus> {
  return invoke<PaReceiverStatus>("pa_receiver_start", {
    host,
    port,
    outputPath,
  });
}

export async function paReceiverStop(): Promise<PaReceiverStatus> {
  return invoke<PaReceiverStatus>("pa_receiver_stop");
}

export async function paReceiverStatus(): Promise<PaReceiverStatus> {
  return invoke<PaReceiverStatus>("pa_receiver_status");
}
