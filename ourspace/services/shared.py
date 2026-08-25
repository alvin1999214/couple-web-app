from ..database import Database


class Service:
    def __init__(self, database: Database):
        self.database = database

