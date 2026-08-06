from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal


@dataclass(frozen=True)
class ProcessOptions:
    remove_background: bool = True
    background: Literal["white", "transparent"] = "white"
    cleanup_noise: bool = True
    crop: bool = True
    padding_ratio: float = 0.08
    width: int = 1600
    height: int = 1600
    output_format: Literal["webp", "jpeg"] = "webp"
    quality: int = 88

    def validate(self) -> None:
        if self.background not in {"white", "transparent"}:
            raise ValueError("background must be white or transparent")
        if self.output_format not in {"webp", "jpeg"}:
            raise ValueError("output_format must be webp or jpeg")
        if self.output_format == "jpeg" and self.background == "transparent":
            raise ValueError("JPEG does not support a transparent background")
        if not 0 <= self.padding_ratio <= 0.4:
            raise ValueError("padding_ratio must be between 0 and 0.4")
        if not 320 <= self.width <= 4096 or not 320 <= self.height <= 4096:
            raise ValueError("width and height must be between 320 and 4096")
        if not 60 <= self.quality <= 100:
            raise ValueError("quality must be between 60 and 100")

    def canonical(self) -> dict:
        return asdict(self)
