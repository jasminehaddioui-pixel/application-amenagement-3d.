import { useState } from 'react';
import { useEditor } from '../state/store';
import { dist } from '../lib/geometry';

/**
 * Calibrage de l'echelle : l'utilisateur a trace une distance sur le plan
 * importe, il saisit ici sa valeur reelle en metres.
 */
export default function ScaleDialog() {
  const calibration = useEditor((s) => s.calibration);
  const store = useEditor;
  const [value, setValue] = useState('');

  if (!calibration) return null;

  const measured = dist(calibration.a, calibration.b);
  const close = () => {
    store.getState().setCalibration(null);
    setValue('');
  };

  const apply = () => {
    const real = Number(value.replace(',', '.'));
    if (!Number.isFinite(real) || real <= 0) {
      store.getState().notify('Saisissez une distance réelle valide, en mètres.', 'error');
      return;
    }
    store.getState().applyScaleFromDistance(calibration.a, calibration.b, real);
    store.getState().setTool('select');
    close();
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" style={{ width: 'min(420px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Régler l'échelle du plan</h2>
        </div>
        <div className="modal-body">
          <p className="hint" style={{ marginTop: 0 }}>
            Vous avez tracé une distance qui mesure actuellement <b>{measured.toFixed(3)} m</b> sur le plan. Indiquez sa
            valeur réelle : tout le plan sera mis à l'échelle en conséquence.
          </p>
          <div className="field">
            <label>Distance réelle (m)</label>
            <input
              className="input"
              autoFocus
              type="number"
              step="0.01"
              min="0.01"
              placeholder="ex. 5.40"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') apply();
                if (e.key === 'Escape') close();
              }}
            />
          </div>
          <p className="hint">
            Conseil : choisissez la plus grande distance connue possible (façade, longueur totale du local) pour
            limiter l'erreur de calibrage.
          </p>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={close}>
            Annuler
          </button>
          <button type="button" className="btn primary" onClick={apply}>
            Appliquer l'échelle
          </button>
        </div>
      </div>
    </div>
  );
}
