"""Alice: lets the Alice app write its own scenes, routines and automations without an administrator's key, and lets automations send messages through it."""

from __future__ import annotations

import asyncio
import os
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import SOURCE_IMPORT, ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.helpers.typing import ConfigType
from homeassistant.util.yaml import load_yaml, save_yaml

from .const import DOMAIN, EVENT_NOTIFY, PROTOCOL, VERSION
from .validate import ID_RE, KINDS, Invalid, check

CONFIG_SCHEMA = cv.empty_config_schema(DOMAIN)

FILES = {"scene": "scenes.yaml", "script": "scripts.yaml", "automation": "automations.yaml"}
PLATFORMS = {"scene": "homeassistant", "script": "script", "automation": "automation"}

NOTIFY_SCHEMA = vol.Schema(
    {
        vol.Required("message"): vol.All(cv.string, vol.Length(min=1, max=300)),
        vol.Optional("title", default=""): vol.All(cv.string, vol.Length(max=80)),
        vol.Optional("severity", default="info"): vol.In(["info", "critical"]),
        vol.Optional("audience", default="all"): vol.In(["all", "admins"]),
    }
)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the commands and the service once; link the app if `alice:` is in configuration.yaml."""
    hass.data[DOMAIN] = {"lock": asyncio.Lock()}

    async def notify(call: ServiceCall) -> None:
        hass.bus.async_fire(EVENT_NOTIFY, dict(call.data))

    hass.services.async_register(DOMAIN, "notify", notify, schema=NOTIFY_SCHEMA)
    websocket_api.async_register_command(hass, ws_hello)
    websocket_api.async_register_command(hass, ws_write)
    websocket_api.async_register_command(hass, ws_delete)
    if DOMAIN in config and not hass.config_entries.async_entries(DOMAIN):
        hass.async_create_task(hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_IMPORT}, data={}))
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    return True


def _device_class(hass: HomeAssistant):
    def lookup(entity_id: str) -> str | None:
        state = hass.states.get(entity_id)
        value = state.attributes.get("device_class") if state else None
        return value if isinstance(value, str) else None

    return lookup


@websocket_api.websocket_command({vol.Required("type"): "alice/hello"})
@callback
def ws_hello(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Who is there, and which dialect it speaks. The app uses this to decide whether it may write through us."""
    connection.send_result(msg["id"], {"version": VERSION, "protocol": PROTOCOL})


def _blocking_write(path: str, kind: str, ident: str, config: dict[str, Any]) -> None:
    empty: Any = {} if kind == "script" else []
    data = load_yaml(path) if os.path.exists(path) else empty
    if data is None:
        data = empty
    if kind == "script":
        data[ident] = config
    else:
        item = {"id": ident, **config}
        for i, existing in enumerate(data):
            if isinstance(existing, dict) and existing.get("id") == ident:
                data[i] = item
                break
        else:
            data.append(item)
    save_yaml(path, data)


def _blocking_delete(path: str, kind: str, ident: str) -> bool:
    if not os.path.exists(path):
        return False
    data = load_yaml(path)
    if kind == "script":
        found = isinstance(data, dict) and ident in data
        if found:
            del data[ident]
    else:
        keep = [x for x in (data or []) if not (isinstance(x, dict) and x.get("id") == ident)]
        found = len(keep) != len(data or [])
        data = keep
    if found:
        save_yaml(path, data)
    return found


@websocket_api.websocket_command(
    {vol.Required("type"): "alice/config_write", vol.Required("kind"): vol.In(KINDS), vol.Required("item_id"): str, vol.Required("config"): dict}
)
@websocket_api.async_response
async def ws_write(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        check(msg["kind"], msg["item_id"], msg["config"], _device_class(hass))
    except Invalid as err:
        connection.send_error(msg["id"], "invalid_config", str(err))
        return
    path = hass.config.path(FILES[msg["kind"]])
    async with hass.data[DOMAIN]["lock"]:
        await hass.async_add_executor_job(_blocking_write, path, msg["kind"], msg["item_id"], msg["config"])
        await hass.services.async_call(msg["kind"], "reload", blocking=True)
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command({vol.Required("type"): "alice/config_delete", vol.Required("kind"): vol.In(KINDS), vol.Required("item_id"): str})
@websocket_api.async_response
async def ws_delete(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    if not ID_RE.match(msg["item_id"]):
        connection.send_error(msg["id"], "invalid_config", "ids must start with alice_")
        return
    path = hass.config.path(FILES[msg["kind"]])
    async with hass.data[DOMAIN]["lock"]:
        found = await hass.async_add_executor_job(_blocking_delete, path, msg["kind"], msg["item_id"])
        await hass.services.async_call(msg["kind"], "reload", blocking=True)
        if found:
            registry = er.async_get(hass)
            entity_id = registry.async_get_entity_id(msg["kind"], PLATFORMS[msg["kind"]], msg["item_id"])
            if entity_id:
                registry.async_remove(entity_id)
    connection.send_result(msg["id"], {"ok": True, "found": found})
