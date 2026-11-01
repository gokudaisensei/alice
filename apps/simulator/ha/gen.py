"""Generates HA package YAML + manifest.json for a realistic simulated home."""
import json, re, yaml
slug = lambda s: re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")
tpl_light, tpl_switch, tpl_fan, tpl_lock, tpl_sensor, tpl_bsensor = [], [], [], [], [], []
ib, inum = {}, {}
man = []  # {entity, name, room, kind}
def reg(domain, name, room, **kw): man.append(dict(entity=f"{domain}.{slug(name)}", name=name, room=room, **kw))
def svc(a, e, **d): return {"action": a, "target": {"entity_id": e}, **({"data": d} if d else {})}

def light(name, room, dim=True, on=False, level=200):
    k = slug(name); b, n = f"input_boolean.{k}_state", f"input_number.{k}_level"
    ib[f"{k}_state"] = {"name": f"{name} state", "initial": on}
    d = {"name": name, "unique_id": f"sim_{k}", "state": f"{{{{ is_state('{b}','on') }}}}",
         "turn_on": [svc("input_boolean.turn_on", b)], "turn_off": [svc("input_boolean.turn_off", b)]}
    if dim:
        inum[f"{k}_level"] = {"name": f"{name} level", "min": 1, "max": 255, "step": 1, "initial": level, "mode": "box"}
        d["level"] = f"{{{{ states('{n}')|int(255) }}}}"
        d["set_level"] = [svc("input_boolean.turn_on", b), svc("input_number.set_value", n, value="{{ brightness }}")]
    tpl_light.append(d); reg("light", name, room, kind="light")
def switch(name, room, on=False, watts=None, icon=None, kind="switch"):
    k = slug(name); b = f"input_boolean.{k}_state"
    ib[f"{k}_state"] = {"name": f"{name} state", "initial": on}
    tpl_switch.append({"name": name, "unique_id": f"sim_{k}", "state": f"{{{{ is_state('{b}','on') }}}}",
        "turn_on": [svc("input_boolean.turn_on", b)], "turn_off": [svc("input_boolean.turn_off", b)]})
    reg("switch", name, room, kind=kind)
    if watts:  # power sensor follows the switch, simulator jiggles the noise helper around `watts`
        inum[f"{k}_watts"] = {"name": f"{name} draw", "min": 0, "max": 20000, "step": 0.1, "initial": watts, "mode": "box"}
        sensor(f"{name} Power", room, f"{{{{ states('input_number.{k}_watts')|float(0) if is_state('switch.{k}','on') else 0 }}}}", "W", "power", "measurement", sim=dict(helper=f"{k}_watts", base=watts, jitter=0.08, gate=f"switch.{k}"))
def fan(name, room, on=False, pct=50):
    k = slug(name); b, n = f"input_boolean.{k}_state", f"input_number.{k}_speed"
    ib[f"{k}_state"] = {"name": f"{name} state", "initial": on}
    inum[f"{k}_speed"] = {"name": f"{name} speed", "min": 0, "max": 100, "step": 1, "initial": pct, "mode": "box"}
    tpl_fan.append({"name": name, "unique_id": f"sim_{k}", "state": f"{{{{ is_state('{b}','on') }}}}",
        "percentage": f"{{{{ states('{n}')|int(0) if is_state('{b}','on') else 0 }}}}", "speed_count": 3,
        "turn_on": [svc("input_boolean.turn_on", b)], "turn_off": [svc("input_boolean.turn_off", b)],
        "set_percentage": [{"if": "{{ percentage > 0 }}", "then": [svc("input_boolean.turn_on", b), svc("input_number.set_value", n, value="{{ percentage }}")], "else": [svc("input_boolean.turn_off", b)]}]})
    reg("fan", name, room, kind="fan")
def lock(name, room, locked=True):
    k = slug(name); b = f"input_boolean.{k}_unlocked"
    ib[f"{k}_unlocked"] = {"name": f"{name} unlocked", "initial": not locked}
    tpl_lock.append({"name": name, "unique_id": f"sim_{k}", "state": f"{{{{ is_state('{b}','off') }}}}",
        "lock": [svc("input_boolean.turn_off", b)], "unlock": [svc("input_boolean.turn_on", b)]})
    reg("lock", name, room, kind="lock")
def sensor(name, room, tmpl, unit, dc, sc="measurement", sim=None, helper=None, base=None, jitter=None, lo=None, hi=None, role="sensor"):
    k = slug(name)
    if helper is None and sim is None:
        helper = f"{k}_v"; inum[helper] = {"name": f"{name} value", "min": -1e6, "max": 1e9, "step": 0.001, "initial": base, "mode": "box"}
        tmpl = f"{{{{ states('input_number.{helper}')|float(0) }}}}"
        sim = dict(helper=helper, base=base, jitter=jitter, lo=lo, hi=hi)
    d = {"name": name, "unique_id": f"sim_{k}", "state": tmpl, "unit_of_measurement": unit, "device_class": dc, "state_class": sc}
    tpl_sensor.append(d); reg("sensor", name, room, kind=role, sim=sim)
def energy(name, room, kwh_per_day, role="energy"):  # accumulating kWh meter
    k = slug(name); helper = f"{k}_kwh"
    inum[helper] = {"name": f"{name} counter", "min": 0, "max": 1e9, "step": 0.001, "initial": round(kwh_per_day * 40, 3), "mode": "box"}
    tpl_sensor.append({"name": name, "unique_id": f"sim_{k}", "state": f"{{{{ states('input_number.{helper}')|float(0) }}}}", "unit_of_measurement": "kWh", "device_class": "energy", "state_class": "total_increasing"})
    reg("sensor", name, room, kind=role, sim=dict(helper=helper, accumulate=True, per_day=kwh_per_day))
def bsensor(name, room, dc, on=False, flip_mins=None, hold_s=30):
    k = slug(name); b = f"input_boolean.{k}_s"
    ib[f"{k}_s"] = {"name": f"{name} s", "initial": on}
    tpl_bsensor.append({"name": name, "unique_id": f"sim_{k}", "state": f"{{{{ is_state('{b}','on') }}}}", "device_class": dc})
    reg("binary_sensor", name, room, kind="bsensor", sim=dict(helper=f"{k}_s", flip_mins=flip_mins, hold_s=hold_s, dc=dc))
def temp(room, base, jitter=0.04): sensor(f"{room} Temperature", room, None, "°C", "temperature", base=base, jitter=jitter, lo=base-3, hi=base+4)
def hum(room, base): sensor(f"{room} Humidity", room, None, "%", "humidity", base=base, jitter=0.25, lo=30, hi=75)

LR, KI, MB, KD, OF, BA, HW, GA, GD = "Living Room","Kitchen","Master Bedroom","Kids Room","Home Office","Bathroom","Hallway","Garage","Garden"
# Living room
light("Floor Lamp", LR, on=True, level=140); light("Sofa Lamp", LR, on=True, level=90); light("TV Backlight", LR, on=False, level=120)
light("Reading Nook Light", LR, dim=False)
switch("Living Room Air Purifier", LR, on=True, watts=34)
switch("TV Plug", LR, on=False, watts=95); temp(LR, 22.4); hum(LR, 46); bsensor("Living Room Motion", LR, "motion", flip_mins=11, hold_s=90)
sensor("Living Room CO2", LR, None, "ppm", "carbon_dioxide", base=620, jitter=8, lo=420, hi=1400)
# Kitchen
light("Under Cabinet Lights", KI, on=True, level=180); light("Island Pendant", KI, on=False, level=210)
switch("Coffee Machine", KI, watts=1100); switch("Dishwasher", KI, watts=1350, on=False); switch("Kettle", KI, watts=2200)
temp(KI, 23.1); hum(KI, 52); bsensor("Fridge Door", KI, "door", flip_mins=40, hold_s=25); bsensor("Kitchen Smoke Detector", KI, "smoke")
switch("Fridge Freezer Plug", KI, on=True, watts=120)
bsensor("Kitchen Window", KI, "window", flip_mins=180, hold_s=1200)
# Master bedroom
light("Bedside Lamp Left", MB, level=70); light("Bedside Lamp Right", MB, level=70); light("Wardrobe Light", MB, dim=False)
fan("Bedroom Ceiling Fan", MB, on=True, pct=33)
temp(MB, 21.6); hum(MB, 48); sensor("Bedroom CO2", MB, None, "ppm", "carbon_dioxide", base=780, jitter=8, lo=450, hi=1600)
bsensor("Bedroom Window", MB, "window", on=True)
# Kids room
light("Kids Night Light", KD, on=True, level=20); light("Kids Ceiling Light", KD, level=230)
switch("Humidifier", KD, on=True, watts=28); temp(KD, 21.2); hum(KD, 55); bsensor("Kids Room Window", KD, "window")
# Office
light("Desk Lamp", OF, on=True, level=200); light("Office Ceiling Light", OF, on=True, level=255)
switch("Monitor Plug", OF, on=True, watts=48); switch("Workstation Plug", OF, on=True, watts=165); switch("3D Printer", OF, watts=110)
temp(OF, 23.4); bsensor("Office Occupancy", OF, "occupancy", on=True, flip_mins=25, hold_s=900)
# Bathroom
light("Vanity Light", BA, level=220); fan("Bathroom Exhaust Fan", BA, pct=66)
switch("Water Heater", BA, on=False, watts=2400); hum(BA, 61); temp(BA, 24.0); bsensor("Bathroom Leak Sensor", BA, "moisture")
switch("Towel Warmer", BA, watts=60)
# Hallway
light("Hallway Light", HW, on=False, level=160); light("Staircase Lights", HW, dim=False)
lock("Front Door Lock", HW); bsensor("Front Door Contact", HW, "door", flip_mins=70, hold_s=20); bsensor("Hallway Motion", HW, "motion", flip_mins=14, hold_s=60)
bsensor("Doorbell Button", HW, "occupancy", flip_mins=150, hold_s=10); temp(HW, 20.8)
# Garage
light("Garage Light", GA, dim=False); lock("Garage Side Door Lock", GA); bsensor("Garage Door Contact", GA, "garage_door", flip_mins=200, hold_s=300)
switch("EV Charger", GA, on=False, watts=7200); energy("EV Charger Energy", GA, 6.0, role="energy"); temp(GA, 16.5, 0.05)
# Garden
light("Porch Light", GD, dim=False); switch("Garden Path Lights", GD, kind="switch"); switch("Front Lawn Sprinkler", GD, watts=40)
lock("Back Door Lock", GD); sensor("Garden Soil Moisture", GD, None, "%", "moisture", base=38, jitter=0.05, lo=15, hi=70)
sensor("Outdoor Temperature", GD, None, "°C", "temperature", base=14.0, jitter=0.04, lo=4, hi=27)
sensor("Outdoor Humidity", GD, None, "%", "humidity", base=68, jitter=0.3, lo=35, hi=95)
sensor("Wind Speed", GD, None, "km/h", "wind_speed", base=11, jitter=0.4, lo=0, hi=45)
# Whole home meters
sensor("Whole Home Power", "", None, "W", "power", base=850, jitter=0.1, lo=180, hi=7000, role="meter")
energy("Whole Home Energy", "", 17.5, role="meter")
sensor("Solar Production Power", "", None, "W", "power", base=0, jitter=0, role="meter")
energy("Solar Energy Produced", "", 9.0, role="meter")
sensor("Grid Voltage", "", None, "V", "voltage", base=230, jitter=0.3, lo=221, hi=238, role="meter")

pk = {"input_boolean": ib, "input_number": inum,
      "template": [{"light": tpl_light}, {"switch": tpl_switch}, {"fan": tpl_fan}, {"lock": tpl_lock}, {"sensor": tpl_sensor}, {"binary_sensor": tpl_bsensor}]}
open("home_package.yaml", "w").write("# generated by gen.py\n" + yaml.safe_dump(pk, sort_keys=False, width=200))
json.dump(man, open("manifest.json", "w"), indent=1)
print(len(man), "devices", len(ib), "booleans", len(inum), "numbers")
