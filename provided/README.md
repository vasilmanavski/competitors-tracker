# Provided services (unmodified)

`listing-source/` and `mock-llm/` are copied byte-for-byte from the assignment's `files/` folder.
They are not part of this codebase. docker compose runs them as stand-ins for the real
competitor websites and the LLM provider. The API reaches them only through
`SOURCE_BASE_URL` and `LLM_BASE_URL`, so either one can be replaced without touching code.
