"""Dev-only conveniences for the standalone web demo.

Everything here exists so a fresh clone can hit ``make seed`` once and
then have any number of browser windows join the same workspace as
distinct anonymous users without going through a real auth flow. When
collaboration-ai is mounted into hof-os the host owns user identity
and these endpoints become a no-op shim.
"""
