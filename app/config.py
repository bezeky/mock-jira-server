from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://jira:jira_password@localhost:5432/jira_mock"
    BASE_URL: str = "http://localhost:8080"
    HOST: str = "0.0.0.0"
    PORT: int = 8080
    SEED_DATA: bool = True
    LOG_LEVEL: str = "INFO"
    model_config = {"env_file": ".env"}


settings = Settings()
