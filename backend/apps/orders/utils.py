SIZE_MAPPING = {
    "kids": {
        "20-24": ["20-24"],
        "20-38": ["20-24", "26-30", "32-36", "38"],
        "20-36": ["20-24", "26-30", "32-36"],
        "26-38": ["26-30", "32-36", "38"],
        "26-36": ["26-30", "32-36"],
        "20-30": ["20-24", "26-30"],
        "32-38": ["32-36", "38"],
        "32-36": ["32-36"],
    },
    "gents": {
        "S,M,L,XL": ["S", "M,L,XL"],
        "S,M,L,XL,XXL": ["S", "M,L,XL", "XXL"],
        "M,L,XL,XXL": ["M,L,XL", "XXL"],
        "M,L,XL": ["M,L,XL"],
    },
}

SIZE_RANGE_TO_SIZES = {
    item_type: list(mapping.values()) for item_type, mapping in SIZE_MAPPING.items()
}

SIZE_RANGE_REVERSE = {
    "kids": {
        frozenset(["20-24", "26-30", "32-36"]): "20-36",
        frozenset(["20-24", "26-30", "32-36", "38"]): "20-38",
        frozenset(["20-24", "26-30"]): "20-30",
        frozenset(["26-30", "32-36"]): "26-36",
        frozenset(["26-30", "32-36", "38"]): "26-38",
        frozenset(["32-36", "38"]): "32-38",
        frozenset(["32-36"]): "32-36",
    },
    "gents": {
        frozenset(["S", "M,L,XL"]): "S,M,L,XL",
        frozenset(["S", "M,L,XL", "XXL"]): "S,M,L,XL,XXL",
        frozenset(["M,L,XL", "XXL"]): "M,L,XL,XXL",
        frozenset(["M,L,XL"]): "M,L,XL",
    },
}


def get_size_range_for_sizes(sizes, item_type):
    size_set = frozenset(sizes)
    reverse_map = SIZE_RANGE_REVERSE.get(item_type, {})
    return reverse_map.get(size_set)


PIECE_COUNT = {
    "gents": {
        "M,L,XL": 3,
        "M,L,XL,XXL": 4,
        "S,M,L,XL": 4,
        "S,M,L,XL,XXL": 5,
    },
    "kids": {
        "20-24": 3,
        "26-30": 3,
        "32-36": 3,
        "38": 1,
        "20-36": 9,
        "20-38": 10,
        "26-36": 6,
        "26-38": 7,
        "20-30": 6,
    },
}


def get_piece_count(size_group, item_type="gents"):
    """Pieces per set for a size group (mirrors the invoice price math)."""
    return PIECE_COUNT.get(item_type, {}).get(size_group, 1)
