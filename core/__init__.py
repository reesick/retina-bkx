"""Shared, deterministic code used by both the ML pipeline (ml/) and the server (server/).

Anything that affects what a model sees (cropping, resizing, normalisation) or how a
decision is made (triage policy) lives here so training and inference cannot drift apart.
"""
