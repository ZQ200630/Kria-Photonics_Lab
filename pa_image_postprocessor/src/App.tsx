import PaImageViewer from "./components/PaImageViewer";
import { DEFAULT_PD_ZERO_ADC_CODE, DEFAULT_TZ_OHM, DEFAULT_UM_PER_COUNT } from "./config";

export default function App() {
  return (
    <main className="app postprocessor-app">
      <PaImageViewer
        tzOhm={DEFAULT_TZ_OHM}
        zeroAdcCode={DEFAULT_PD_ZERO_ADC_CODE}
        umPerCount={DEFAULT_UM_PER_COUNT}
      />
    </main>
  );
}
