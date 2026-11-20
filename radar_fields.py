"""Raw radar attributes. No grade/price/AimAssist proxy for detection."""
import re


def radar_fields(item):
    r = (item.get('stdItem') or {}).get('Radar') or {}
    out = {}
    if r:
        out['detection'] = {k: r[k] for k in (
            'Sensitivity', 'Piercing', 'GroundVehicleDetectionSensitivity',
            'GroundVehicleSensitivityAddition', 'SignatureDetection', 'Cooldown') if k in r}
    # Bespoke/internal variants are not proven interchangeable by a size match.
    if re.search(r'Fake|Default|Template|TEMP|_Piercing|_Polaris', item.get('className', ''), re.I):
        out['radarStockOnly'] = True
    return out
