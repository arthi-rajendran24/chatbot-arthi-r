"""Local API tests use isolated configuration and never read the real .env."""

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

import app as webapp
from profile_chat import GeminiUnavailable


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Set the temporary path before any request can call settings().
    env_path = tmp_path / ".env"
    env_path.write_text("GEMINI_API_KEY=\nGEMINI_MODEL=test-model\n", encoding="utf-8")
    profile_path = tmp_path / "profile.md"
    profile_path.write_text("# Example Person\n\n## Work\n\nTeaches AI workshops.\n", encoding="utf-8")
    monkeypatch.setattr(webapp, "ENV_PATH", env_path)
    monkeypatch.setattr(webapp, "PROFILE_PATH", profile_path)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    with TestClient(webapp.app) as test_client:
        yield test_client


def test_status_and_profile_expose_source_metadata_without_credentials(client):
    status = client.get("/api/status")
    assert status.status_code == 200
    assert status.json() == {
        "configured": False,
        "model": "test-model",
        "profile": {"title": "Example Person", "filename": "profile.md", "section_count": 2},
        "error": None,
    }
    profile = client.get("/api/profile")
    assert profile.status_code == 200
    data = profile.json()
    assert data["lines"] == [
        {"number": index, "text": line}
        for index, line in enumerate(data["markdown"].splitlines(), start=1)
    ]
    assert data["title"] == "Example Person"
    assert len(data["version"]) == 16
    assert status.headers["cache-control"] == "no-store"
    assert "frame-ancestors 'none'" in status.headers["content-security-policy"]


def test_missing_api_key_stops_before_provider_call(client, monkeypatch):
    provider = MagicMock()
    monkeypatch.setattr(webapp, "ask_gemini", provider)
    result = client.post("/api/chat", json={"question": "What work?"})
    assert result.status_code == 503
    assert "Add GEMINI_API_KEY" in result.json()["detail"]
    provider.assert_not_called()


def test_env_hot_reload_reads_new_local_key_without_restart(client, monkeypatch):
    assert client.get("/api/status").json()["configured"] is False
    webapp.ENV_PATH.write_text(
        "GEMINI_API_KEY=test-only-key\nGEMINI_MODEL=changed-model\n", encoding="utf-8"
    )
    provider = MagicMock(return_value={"found": False, "answer": "test answer", "sources": []})
    monkeypatch.setattr(webapp, "ask_gemini", provider)
    status = client.get("/api/status").json()
    assert status["configured"] is True
    assert status["model"] == "changed-model"
    assert "test-only-key" not in str(status)
    assert client.post("/api/chat", json={"question": "  What work?  "}).status_code == 200
    arguments = provider.call_args.args
    assert arguments[0] == "What work?"
    assert arguments[2:] == ("test-only-key", "changed-model")


@pytest.mark.parametrize("placeholder", ["your_api_key_here", "paste_your_key_here", "YOUR_GEMINI_API_KEY_HERE"])
def test_placeholder_keys_remain_unconfigured(client, placeholder):
    webapp.ENV_PATH.write_text(f"GEMINI_API_KEY={placeholder}\n", encoding="utf-8")
    assert client.get("/api/status").json()["configured"] is False


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"question": ""},
        {"question": " \n\t "},
        {"question": 123},
        {"question": None},
        {"question": "x" * 2001},
        {"question": "What work?", "api_key": "unwanted-client-value"},
    ],
)
def test_invalid_questions_are_rejected_before_provider(client, monkeypatch, payload):
    provider = MagicMock()
    monkeypatch.setattr(webapp, "ask_gemini", provider)
    assert client.post("/api/chat", json=payload).status_code == 422
    provider.assert_not_called()


def test_untrusted_origins_and_non_json_requests_are_rejected(client):
    result = client.post(
        "/api/chat", json={"question": "What work?"}, headers={"origin": "https://untrusted.example"}
    )
    assert result.status_code == 403
    assert client.post("/api/chat", data={"question": "What work?"}).status_code == 415
    assert client.post(
        "/api/chat", json={"question": "What work?"}, headers={"origin": "http://testserver"}
    ).status_code == 503  # Accepted origin, then missing-key guard.


def test_untrusted_host_is_rejected(client):
    assert client.get("/api/status", headers={"host": "untrusted.example"}).status_code == 400


def test_api_surfaces_only_safe_provider_error(client, monkeypatch):
    webapp.ENV_PATH.write_text("GEMINI_API_KEY=test-only-key\n", encoding="utf-8")
    monkeypatch.setattr(
        webapp, "ask_gemini",
        MagicMock(side_effect=GeminiUnavailable("Gemini quota reached. Try later.", 429)),
    )
    response = client.post("/api/chat", json={"question": "What work?"})
    assert response.status_code == 429
    assert response.json() == {"detail": "Gemini quota reached. Try later."}


def test_missing_source_reports_failure_without_claiming_absent_fact(client):
    webapp.PROFILE_PATH.unlink()
    status = client.get("/api/status").json()
    assert status["profile"] is None
    assert "could not be read" in status["error"]
    assert client.get("/api/profile").status_code == 503


def test_local_env_is_not_served(client):
    webapp.ENV_PATH.write_text("GEMINI_API_KEY=test-only-key\n", encoding="utf-8")
    for url in ("/.env", "/static/.env", "/data/profile.md"):
        response = client.get(url)
        assert response.status_code == 404
        assert "test-only-key" not in response.text
