"""Verify analysis dependencies using fixed examples, without loading case data."""

import math
import os
from pathlib import Path
import tempfile
from importlib.metadata import version


def main() -> None:
    # Keep plotting caches out of the user's home directory on shared machines.
    os.environ.setdefault(
        "MPLCONFIGDIR", str(Path(__file__).resolve().parent.parent / ".mplconfig")
    )
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import pandas as pd
    import psycopg
    from scipy.stats import binomtest
    from sklearn.metrics import cohen_kappa_score
    from statsmodels.stats.proportion import proportion_confint

    pvalue = binomtest(1, 10, 0.5).pvalue
    if not math.isclose(pvalue, 0.021484375, abs_tol=1e-12):
        raise RuntimeError("Unexpected exact binomial result.")

    lower, upper = proportion_confint(1, 10, method="wilson")
    if not 0 < lower < 0.1 < upper < 1:
        raise RuntimeError("Unexpected Wilson interval.")

    kappa = cohen_kappa_score(["approve", "deny"], ["approve", "deny"])
    if not math.isclose(kappa, 1.0):
        raise RuntimeError("Unexpected agreement result.")

    if pd.DataFrame({"decision": ["approve", "deny"]}).shape != (2, 1):
        raise RuntimeError("DataFrame construction failed.")
    if not psycopg.pq.version():
        raise RuntimeError("Postgres client library is unavailable.")

    # A temporary image verifies rendering without creating apparent study results.
    with tempfile.TemporaryDirectory() as directory:
        figure, axis = plt.subplots()
        try:
            axis.plot([0, 1], [0, 1])
            image = Path(directory) / "check.png"
            figure.savefig(image)
            if image.read_bytes()[:8] != bytes([137, 80, 78, 71, 13, 10, 26, 10]):
                raise RuntimeError("PNG rendering failed.")
        finally:
            plt.close(figure)

    print(f"Analysis environment OK: binomial p={pvalue:.9f}; Wilson, kappa, dataframes, PNG, Postgres client OK.")
    for package in ("scipy", "statsmodels", "scikit-learn", "pandas", "matplotlib", "psycopg", "psycopg-binary"):
        print(f"{package}=={version(package)}")


if __name__ == "__main__":
    main()
