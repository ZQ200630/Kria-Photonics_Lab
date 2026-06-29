import { describe, expect, it } from "vitest";
import {
  lockSweepPartialCsv,
  monitorCsv,
  preLockPdValues,
  spectrumFrameCsv,
  spectrumFramesCsv,
  trendWindow,
  type RecordingSpectrumFrame,
  type RecordingTrendSample,
} from "../utils/lockRecording";
import { adcCodeToInputCurrentMicroamp } from "../utils/ada4355";

function pdCurrent(adc: number): string {
  return adcCodeToInputCurrentMicroamp(adc, 2000).toFixed(6);
}

function pdCurrentWithZeroAdcCode(adc: number): string {
  return adcCodeToInputCurrentMicroamp(adc, 2000, 29620).toFixed(6);
}

describe("lock recording export helpers", () => {
  const frame: RecordingSpectrumFrame = {
    values: [0xff00, 0xfe00, 0xfd00].map((adc) => 0xffff - adc),
    count: 3,
    durationMs: 2,
    frameCounter: 7,
  };

  it("exports spectrum data with scanned CH1 current and raw ADC count", () => {
    expect(spectrumFrameCsv(frame, 0, 65535).trim().split("\n")).toEqual([
      "ch1_current_mA,pd_current_uA,ch1_code,adc_count,relative_intensity,index,time_ms",
      `0.000000,${pdCurrent(65280)},0,65280,255,0,0.000000`,
      `5.000076,${pdCurrent(65024)},32768,65024,511,1,1.000000`,
      `10.000000,${pdCurrent(64768)},65535,64768,767,2,2.000000`,
    ]);
  });

  it("exports multiple named spectrum frames with scanned CH1 context", () => {
    const secondFrame: RecordingSpectrumFrame = {
      values: [0xfc00, 0xfb00].map((adc) => 0xffff - adc),
      count: 2,
      durationMs: 4,
      frameCounter: 8,
    };

    expect(spectrumFramesCsv([frame, secondFrame], 1000, 3000).trim().split("\n")).toEqual([
      "ch1_current_mA,pd_current_uA,record_index,frame_counter,index,time_ms,ch1_code,adc_count,relative_intensity",
      `0.152590,${pdCurrent(65280)},0,7,0,0.000000,1000,65280,255`,
      `0.305180,${pdCurrent(65024)},0,7,1,1.000000,2000,65024,511`,
      `0.457771,${pdCurrent(64768)},0,7,2,2.000000,3000,64768,767`,
      `0.152590,${pdCurrent(64512)},1,8,0,0.000000,1000,64512,1023`,
      `0.457771,${pdCurrent(64256)},1,8,1,4.000000,3000,64256,1279`,
    ]);
  });

  it("exports estimated partial lock sweep with reference alignment", () => {
    expect(lockSweepPartialCsv(frame, 1000, 3000, 1, 1).trim().split("\n")).toEqual([
      "ch1_current_mA,pd_current_uA,ch1_code,adc_count,relative_intensity,current_index,reference_index,time_ms",
      `0.152590,${pdCurrent(65280)},1000,65280,255,0,1,0.000000`,
      `0.305180,${pdCurrent(65024)},2000,65024,511,1,2,1.000000`,
    ]);
  });

  it("filters monitor samples around the lock time and exports raw values", () => {
    const samples: RecordingTrendSample[] = [
      { t: 90, pd: 10, temp: 30.1, tempMeasured: 30.2, target: 31, error: 0.9, dac: 2000, tecRaw: 123 },
      { t: 95, pd: 11, temp: 30.3, target: 31, error: 0.7, dac: 2001, laserMode: "scan" },
      { t: 101, pd: 12, temp: 30.4, target: 31, error: 0.6, dac: 2002 },
      { t: 110, pd: 13, temp: 30.5, target: 31, error: 0.5, dac: 2003 },
    ];
    expect(trendWindow(samples, 100, 6, 5).map((sample) => sample.t)).toEqual([95, 101]);
    const lines = monitorCsv(trendWindow(samples, 100, 6, 5), 100).trim().split("\n");
    expect(lines[0]).toBe("relative_time_s,timestamp_s,laser_mode,pd_adc,pd_current_uA,temp_filtered_c,temp_measured_c,temp_target_c,temp_error_c,tec_dac_code,tec_raw_adc");
    expect(lines[1]).toBe(`-5.000000,95.000000,Scan,11,${pdCurrent(11)},30.300000,,31.000000,0.700000,2001,`);
  });

  it("freezes only pre-lock PD samples for the lock display", () => {
    const samples: RecordingTrendSample[] = [
      { t: 92, pd: 9 },
      { t: 95, pd: 10 },
      { t: 99.5, pd: 11 },
      { t: 100, pd: 12 },
      { t: 100.5, pd: 13 },
      { t: 101, pd: undefined },
      { t: 102, pd: 14 },
    ];

    expect(preLockPdValues(samples, 100, 5)).toEqual([10, 11, 12]);
  });

  it("exports lock spectra with the configured photodiode zero ADC code", () => {
    expect(spectrumFrameCsv(frame, 0, 65535, 2000, 29620).trim().split("\n")[1]).toBe(
      `0.000000,${pdCurrentWithZeroAdcCode(65280)},0,65280,255,0,0.000000`,
    );
  });
});
