defmodule Gamepedia.ControllerHelpers do
  @moduledoc "Shared helpers for Gamepedia controllers."

  def parse_int(v) when is_integer(v), do: v
  def parse_int(v) when is_binary(v) do
    case Integer.parse(v) do
      {i, _} -> i
      :error  -> 0
    end
  end
  def parse_int(_), do: 0

  def format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc ->
        String.replace(acc, "%{#{k}}", to_string(v))
      end)
    end)
  end

  def nexus_user_id(conn) do
    conn
    |> Plug.Conn.get_req_header("x-nexus-user-id")
    |> List.first()
    |> parse_int()
  end

  def release_year(nil), do: nil
  def release_year(ts),  do: ts |> DateTime.from_unix!() |> Map.get(:year)
end
