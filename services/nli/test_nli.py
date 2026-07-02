from fastapi.testclient import TestClient

from app import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200


def test_nli_contradiction_direction():
    response = client.post(
        "/nli",
        json={
            "premise": "신용심사 결과에 따라 승인 여부 및 금리는 달라질 수 있습니다.",
            "hypothesis": "Guaranteed approval at 4.9% for everyone.",
        },
    )
    assert response.status_code == 200
    scores = response.json()["scores"]
    assert set(scores) == {"entailment", "neutral", "contradiction"}
    assert scores["contradiction"] > scores["entailment"]
