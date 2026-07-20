defmodule Gamepedia.ConfigController do
  @moduledoc """
  Exposes the subset of Gamepedia's extension settings that the JS bundle
  needs to read on every page.

  This is a deliberately narrow public surface: only values that affect UI
  rendering (slideshow timing, max-linked-games cap) are exposed. Credentials
  and any other sensitive settings stay server-side, accessible only via the
  admin endpoints.

  Why a dedicated endpoint and not `_nexusExtensionManifests`: the manifest
  carries the *schema* (field definitions, defaults), not the *values* an
  admin has saved. Per-install configuration lives in `extensions.settings`,
  which is admin-only via the standard Nexus endpoint. This controller
  serves the safe slice of that to anyone, including logged-out visitors.
  """

  use Phoenix.Controller, formats: [:json]
  alias Gamepedia.Settings

  def show(conn, _params) do
    # One settings read, two values. Calling get_int/2 twice meant two
    # uncached DB round-trips to serve a two-field response.
    settings = Settings.all()

    json(conn, %{data: %{
      max_linked_games:  Settings.get_int(settings, "max_linked_games",  3),
      slideshow_seconds: Settings.get_int(settings, "slideshow_seconds", 5),
    }})
  end
end
