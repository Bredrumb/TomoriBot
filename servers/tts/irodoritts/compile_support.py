"""Make Irodori's torch.compile path cacheable and recompile-stable.

The upstream runtime compiles three model methods but leaves two traps: RoPE
caches that grow lazily under inference mode, and an ``sdpa_kernel`` context
that Dynamo records as an uncacheable call. Both patches target the Irodori
revision pinned in ``pyproject.toml``.
"""

from __future__ import annotations

import importlib.util
import shutil
import sys

import torch

COMPILE_MODES = ("off", "compile", "cudagraphs")

# Covers the 30 s synthesis cap, the longest reference latent, and the text limit.
ROPE_POSITIONS = 4096


def require_compile_prerequisites(model_device: str) -> None:
  """Raise instead of letting Inductor fail mid-warmup or fall back to eager."""
  if not model_device.startswith("cuda") or torch.version.cuda is None:
    raise RuntimeError(
      "IRODORI_COMPILE_MODE needs an NVIDIA CUDA model device (the cu128 backend). "
      "Set IRODORI_COMPILE_MODE=off on other backends."
    )
  if importlib.util.find_spec("triton") is None:
    raise RuntimeError(
      "IRODORI_COMPILE_MODE needs Triton. Rerun the install script with the cu128 backend."
    )
  # Inductor builds a few CPU kernels with MSVC on Windows.
  if sys.platform == "win32" and shutil.which("cl") is None:
    raise RuntimeError(
      "IRODORI_COMPILE_MODE on Windows needs the MSVC compiler (cl) on PATH. Start the server "
      "from a Developer PowerShell for Visual Studio, or import vcvars64.bat first."
    )


def compile_model(model: torch.nn.Module, *, cudagraphs: bool) -> None:
  """Compile the methods upstream compiles, applying the fixes below first."""
  configure_inductor()
  bypass_sdpa_priority_when_compiling()
  prefill_rope_caches(model)
  model.encode_conditions = torch.compile(model.encode_conditions, dynamic=True)
  model.build_context_kv_cache = torch.compile(model.build_context_kv_cache, dynamic=True)
  # Only the per-step denoiser replays a graph: condition outputs outlive many replays.
  model.forward_with_encoded_conditions = torch.compile(
    model.forward_with_encoded_conditions,
    dynamic=True,
    mode="reduce-overhead" if cudagraphs else None,
  )


def configure_inductor() -> None:
  # torch 2.10 runs this analysis on dynamic-shape kernels and trips a sympy assertion.
  torch._inductor.config.triton.coalesce_tiling_analysis = False


def bypass_sdpa_priority_when_compiling() -> None:
  """Let Inductor choose the SDPA kernel instead of tracing ``sdpa_kernel``."""
  from irodori_tts import attention, model

  eager_masked_sdpa = attention.masked_sdpa

  def masked_sdpa(q, k, v, attn_mask):
    if torch.compiler.is_compiling():
      return attention._sdpa(q, k, v, attn_mask)
    return eager_masked_sdpa(q, k, v, attn_mask)

  # model.py imports the name directly, so both bindings need the wrapper.
  attention.masked_sdpa = masked_sdpa
  model.masked_sdpa = masked_sdpa


def prefill_rope_caches(model: torch.nn.Module, positions: int = ROPE_POSITIONS) -> None:
  """Size every RoPE cache once so lazy growth never invalidates compiled guards."""
  from irodori_tts.model import precompute_freqs_cis

  device = next(model.parameters()).device
  # Built outside inference mode: an inference tensor here fails Dynamo's dispatch-key guard.
  with torch.inference_mode(False), torch.no_grad():
    for module in model.modules():
      if hasattr(module, "_freqs_cis_cache") and hasattr(module, "head_dim"):
        module._freqs_cis_cache = precompute_freqs_cis(module.head_dim, positions).to(device)
