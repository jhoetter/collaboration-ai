"""Multilingual search across English / German / Japanese / emoji."""

from __future__ import annotations

from domain.chat.search import normalize, search_messages, tokenize

from .fixtures import bootstrap, send


def test_normalisation_collapses_full_width_and_case() -> None:
    assert normalize("Ｈｅｌｌｏ") == "hello"
    assert normalize("HELLO") == "hello"


def test_tokenisation_splits_on_word_boundaries() -> None:
    assert "hello" in tokenize("Hello, world!")
    assert "world" in tokenize("Hello, world!")
    assert "über" in tokenize("Über alles")  # noqa: RUF001


def test_search_finds_english_message() -> None:
    bs = bootstrap()
    send(bs, bs.users[1], "ch_general", "Hello world!")
    hits = search_messages(bs.state, workspace_id=bs.workspace_id, query="hello")
    assert len(hits) == 1
    assert hits[0].content == "Hello world!"


def test_search_full_width_matches_ascii() -> None:
    bs = bootstrap()
    send(bs, bs.users[1], "ch_general", "Hello world!")
    hits = search_messages(bs.state, workspace_id=bs.workspace_id, query="ｈｅｌｌｏ")
    assert len(hits) == 1


def test_search_cjk_per_character_matches_substring() -> None:
    bs = bootstrap()
    send(bs, bs.users[1], "ch_general", "うちの猫が好きです")
    hits = search_messages(bs.state, workspace_id=bs.workspace_id, query="猫")
    assert len(hits) == 1


def test_search_german_umlaut_normalises() -> None:
    bs = bootstrap()
    send(bs, bs.users[1], "ch_general", "Schöne Grüße aus München!")
    hits = search_messages(bs.state, workspace_id=bs.workspace_id, query="grüße")
    assert len(hits) == 1


def test_search_filters_by_channel() -> None:
    bs = bootstrap()
    send(bs, bs.users[1], "ch_general", "alpha")
    send(bs, bs.users[1], "ch_random", "alpha")
    hits = search_messages(
        bs.state,
        workspace_id=bs.workspace_id,
        query="alpha",
        channel_ids=["ch_general"],
    )
    assert {h.channel_id for h in hits} == {"ch_general"}


def test_search_skips_redacted_messages() -> None:
    from domain.shared.command_bus import Command

    bs = bootstrap()
    res = send(bs, bs.users[1], "ch_general", "secret token: ABC123")
    msg_id = res.events[0].event_id
    bs.bus.dispatch(
        Command(
            type="chat:delete-message",
            payload={"target_event_id": msg_id, "reason": "leak"},
            source="human",
            actor_id=bs.users[1],
            workspace_id=bs.workspace_id,
        )
    )
    hits = search_messages(bs.state, workspace_id=bs.workspace_id, query="ABC123")
    assert hits == []
