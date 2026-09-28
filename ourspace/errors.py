class ApiError(Exception):
    def __init__(self, message: str, status: int = 400, *, details: dict | None = None):
        super().__init__(message)
        self.status = status
        self.details = details or {}
