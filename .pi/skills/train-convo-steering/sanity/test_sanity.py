"""
Sanity tests for train-convo-steering skill.
"""
from train_convo_steering.schema import TurnLog
from train_convo_steering.heuristics import estimate_state_bucket
from train_convo_steering.presets import default_presets
from train_convo_steering.policy import choose_preset

def test_imports():
    """Verify core modules can be imported."""
    import train_convo_steering.pipeline
    import train_convo_steering.cli
    assert True

def test_heuristics():
    """Verify heuristic state estimation logic."""
    state = estimate_state_bucket("slow down, I am confused")
    assert state["tempo"] == "high"  # 'slow' -> high (more time/detail)
    assert state["alignment"] == "low"  # 'confused' -> low

def test_policy_fallback():
    """Verify policy returns a valid preset even without priors."""
    presets = default_presets()
    state = {"tempo": "mid", "trust": "mid", "alignment": "mid", "affect": "mid", "control": "mid"}
    decision = choose_preset(state, presets, user_prior=None)
    assert decision.preset_id in [p.preset_id for p in presets]
    assert decision.confidence > 0.0

if __name__ == "__main__":
    test_imports()
    test_heuristics()
    test_policy_fallback()
    print("Sanity tests passed!")
