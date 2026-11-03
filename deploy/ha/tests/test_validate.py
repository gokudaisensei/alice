"""Runs without Home Assistant:  python3 deploy/ha/tests/test_validate.py"""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("validate", pathlib.Path(__file__).parents[1] / "custom_components" / "alice" / "validate.py")
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)

LIGHT = {"action": "light.turn_on", "target": {"entity_id": "light.a"}, "data": {"brightness_pct": 50}}


def script(*steps):
    return {"alias": "x", "description": "d", "mode": "single", "sequence": list(steps)}


class Allowed(unittest.TestCase):
    def test_what_the_app_writes(self):
        v.check("script", "alice_routine_ab12", script(LIGHT, {"delay": {"seconds": 5}}))
        v.check("scene", "alice_ab12", {"name": "n", "entities": {"light.a": {"state": "on", "brightness": 100}}})
        v.check("automation", "alice_auto_ab12", {
            "alias": "a", "mode": "single", "max_exceeded": "silent",
            "triggers": [{"trigger": "state", "entity_id": ["person.a"], "from": "not_home", "to": "home"}, {"trigger": "sun", "event": "sunset", "offset": "-00:30:00"},
                         {"trigger": "time", "at": "07:00:00"}, {"trigger": "numeric_state", "entity_id": "sensor.t", "above": 3, "for": {"seconds": 60}}],
            "conditions": [{"condition": "not", "conditions": [{"condition": "or", "conditions": [{"condition": "state", "entity_id": "person.a", "state": "home"}]}]}, {"condition": "time", "weekday": ["mon"]}],
            "actions": [{"action": "scene.turn_on", "target": {"entity_id": "scene.x"}}],
        })

    def test_a_blind_may_open(self):
        v.check("script", "alice_x", script({"action": "cover.open_cover", "target": {"entity_id": "cover.blind"}}), lambda i: "blind")


class Refused(unittest.TestCase):
    def refuses(self, *args):
        with self.assertRaises(v.Invalid):
            v.check(*args)

    def test_ids(self):
        for bad in ("evil", "alice_", "alice_UPPER", "alice_" + "x" * 80, "../alice_x", "alice_x.y"):
            self.refuses("script", bad, script(LIGHT))

    def test_services_that_let_something_in_or_run_code(self):
        for action, domain in (("lock.unlock", "lock"), ("alarm_control_panel.alarm_disarm", "alarm_control_panel"), ("homeassistant.restart", "homeassistant"),
                               ("shell_command.run", "shell_command"), ("script.turn_on", "script"), ("automation.trigger", "automation")):
            self.refuses("script", "alice_x", script({"action": action, "target": {"entity_id": domain + ".a"}}))

    def test_a_service_aimed_at_another_domain(self):
        self.refuses("script", "alice_x", script({"action": "light.turn_on", "target": {"entity_id": "lock.a"}}))

    def test_opening_things_that_guard_the_home(self):
        self.refuses("script", "alice_x", script({"action": "cover.open_cover", "target": {"entity_id": "cover.garage"}}), lambda i: "garage")
        self.refuses("script", "alice_x", script({"action": "valve.open_valve", "target": {"entity_id": "valve.main"}}), lambda i: "water")

    def test_templates_anywhere(self):
        self.refuses("script", "alice_x", {"alias": "{{ 1 }}", "sequence": [{"delay": {"seconds": 1}}]})
        self.refuses("script", "alice_x", script({**LIGHT, "data": {"a": "{{ states('x') }}"}}))
        self.refuses("script", "alice_x", script({**LIGHT, "data": {"a": "{% if 1 %}x{% endif %}"}}))

    def test_shapes_the_app_does_not_make(self):
        self.refuses("automation", "alice_x", {"alias": "a", "triggers": [{"trigger": "template", "value_template": "x"}], "actions": [{"delay": {"seconds": 1}}]})
        self.refuses("automation", "alice_x", {"alias": "a", "triggers": [{"trigger": "time", "at": "07:00:00"}], "actions": [{"action": "light.turn_on", "target": {"entity_id": "light.a"}, "extra": 1}]})
        self.refuses("scene", "alice_x", {"name": "n", "entities": {"lock.a": {"state": "unlocked"}}})
        self.refuses("scene", "alice_x", {"name": "n", "entities": {"light.a": {"state": "on"}}, "extra": 1})
        self.refuses("script", "alice_x", script({"delay": {"seconds": 99999}}))
        self.refuses("script", "alice_x", script(*[LIGHT] * 41))


if __name__ == "__main__":
    unittest.main()
